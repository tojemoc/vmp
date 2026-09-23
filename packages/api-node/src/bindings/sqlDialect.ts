/**
 * Translates D1/SQLite SQL (used by @vmp/api) into PostgreSQL for Deno Deploy managed SQL.
 * Deno Deploy cannot load native addons (better-sqlite3); the Worker code stays unchanged.
 */

/** Split SQL on `?` placeholders outside string literals (for postgres.js tagged templates). */
export function splitQuestionMarks(sql: string): string[] {
  const parts: string[] = [''];
  let partIndex = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const nextCh = sql[i + 1];
    if (ch === "'" && !inDouble) {
      if (nextCh === "'") {
        parts[partIndex]! += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      parts[partIndex]! += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      if (nextCh === '"') {
        parts[partIndex]! += '""';
        i += 1;
        continue;
      }
      inDouble = !inDouble;
      parts[partIndex]! += ch;
      continue;
    }
    if (ch === '?' && !inSingle && !inDouble) {
      parts.push('');
      partIndex += 1;
      continue;
    }
    parts[partIndex]! += ch;
  }
  return parts;
}

/** Replace `?` placeholders outside string literals with `$1`, `$2`, … */
export function bindQuestionMarks(sql: string, paramCount: number): string {
  if (paramCount === 0) return sql;
  let index = 0;
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const nextCh = sql[i + 1];
    if (ch === "'" && !inDouble) {
      if (nextCh === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      if (nextCh === '"') {
        out += '""';
        i += 1;
        continue;
      }
      inDouble = !inDouble;
      out += ch;
      continue;
    }
    if (ch === '?' && !inSingle && !inDouble) {
      index += 1;
      if (index > paramCount) {
        throw new Error(`SQL has more ? placeholders than bound parameters (${paramCount})`);
      }
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  if (index !== paramCount) {
    throw new Error(`SQL has ${index} ? placeholders but ${paramCount} parameters were bound`);
  }
  return out;
}

/** Runtime + migration SQL dialect tweaks (SQLite → PostgreSQL). */
export function translateSqliteToPostgres(sql: string): string {
  let s = sql.trim();

  // Strip SQLite PRAGMA (Postgres uses different session settings).
  s = s.replace(/^\s*PRAGMA\s+[^;]+;\s*/gim, '');

  // SQLite trigger bodies (BEGIN … END;) are invalid in Postgres; use -- POSTGRES: replacements.
  s = s.replace(
    /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w]+\s+[\s\S]*?\bBEGIN\b[\s\S]*?\bEND\s*;/gi,
    '',
  );

  // sqlite_master introspection (admin health / seed helpers in @vmp/api).
  s = s.replace(
    /FROM\s+sqlite_master\b/gi,
    "FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  s = s.replace(/\btype\s*=\s*'table'/gi, "table_type = 'BASE TABLE'");

  // PRAGMA table_info(tbl) → information_schema (used by brevo + kv bootstrap).
  s = s.replace(/PRAGMA\s+table_info\s*\(\s*([`'"]?)(\w+)\1\s*\)/gi, (_m, _q, table) => {
    return `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`;
  });

  // DML compatibility — rewrite INSERT OR IGNORE per statement (literal-aware).
  // Do NOT regex across the whole migration file: multi-statement seeds and
  // quoted semicolons must stay intact; trailing -- POSTGRES: hints must remain.
  s = rewriteInsertOrIgnoreStatements(s);
  s = s.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO');
  s = s.replace(/\bREPLACE\s+INTO\b/gi, 'INSERT INTO');

  // datetime('now', modifier) — SQLite modifier strings
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+seconds'\s*\)/gi,
    (_m, sec) => `(CURRENT_TIMESTAMP + interval '${sec} seconds')`,
  );
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+hours'\s*\)/gi,
    (_m, hrs) => `(CURRENT_TIMESTAMP - interval '${hrs} hours')`,
  );
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+minutes'\s*\)/gi,
    (_m, min) => `(CURRENT_TIMESTAMP + interval '${min} minutes')`,
  );
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');

  // datetime(column, modifier) — brevo claim timeouts
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*\?\s*\)/gi,
    "(CURRENT_TIMESTAMP + (?::text || ' seconds')::interval)",
  );
  s = s.replace(
    /datetime\s*\(\s*created_at\s*,\s*\?\s*\)/gi,
    "(created_at::timestamptz + (?::text || ' seconds')::interval)",
  );

  // datetime(?) — replication cursors, analytics date filters (before column-name pass)
  s = s.replace(/datetime\s*\(\s*\?\s*\)/gi, '(?::timestamptz)');

  // datetime(expr) comparisons — treat text timestamps as timestamptz
  s = s.replace(/datetime\s*\(\s*([a-zA-Z0-9_.]+)\s*\)/g, '($1::timestamptz)');

  s = s.replace(/\bunixepoch\s*\(\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::bigint');
  s = s.replace(
    /\bunixepoch\s*\(\s*\)\s*<\s*unixepoch\s*\(\s*\)/gi,
    'EXTRACT(EPOCH FROM NOW()) < EXTRACT(EPOCH FROM NOW())',
  );
  s = s.replace(
    /expires_at\s*<\s*unixepoch\s*\(\s*\)/gi,
    'expires_at < EXTRACT(EPOCH FROM NOW())::bigint',
  );
  s = s.replace(
    /expires_at\s*>=\s*unixepoch\s*\(\s*\)/gi,
    'expires_at >= EXTRACT(EPOCH FROM NOW())::bigint',
  );
  s = s.replace(/\bunixepoch\s*\(\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::bigint');

  // strftime/date analytics transforms with nested datetime(...) support.
  s = replaceDateTimeWrapperPatterns(s);

  // Catch any remaining SQLite datetime(...) Postgres does not implement.
  // Use balanced-paren matching so nested COALESCE(...) is not truncated at the
  // first inner ')'.
  s = replaceSqlFunctionCalls(s, 'datetime', (inner) => {
    const expr = inner.trim();
    if (/^'now'/i.test(expr)) return 'CURRENT_TIMESTAMP';
    if (/^CURRENT_TIMESTAMP$/i.test(expr)) return 'CURRENT_TIMESTAMP';
    return `(${expr}::timestamptz)`;
  });

  // SQLite trim() accepts any type; Postgres trim/btrim is text-only (TIMESTAMPTZ → 42883).
  // Balanced parens required: TRIM(COALESCE((SELECT …), '')) must not stop at the
  // first ')' (that bug broke migration 0066 on Deno Deploy / Postgres).
  s = replaceSqlFunctionCalls(s, 'trim', (inner) => `btrim((${inner})::text)`);

  // SQLite implicit rowid (e.g. migration 0029 dedup) → Postgres ctid system column.
  s = s.replace(/\browid\b/gi, 'ctid');

  // SQLite instr(haystack, needle) → Postgres strpos(haystack, needle).
  // Only replace outside literals, comments, and dollar-quoted text.
  s = transformExecutableSql(s, (code) => code.replace(/\binstr\s*\(/gi, 'strpos('));

  // SQLite json_insert UPDATE — strip on Postgres; migration files provide a
  // -- POSTGRES: equivalent (see expandPostgresOnlyStatements) for the same path.
  s = stripJsonInsertUpdateStatements(s);

  // /* vmp:sqlite-only */ blocks — D1 runs them; Postgres uses -- POSTGRES: peers.
  s = stripVmpSqliteOnlyStatements(s);

  return s;
}

type SqlScanState =
  | 'code'
  | 'single'
  | 'double'
  | 'dollar'
  | 'lineComment'
  | 'blockComment';

type SqlSegment =
  | { kind: 'code'; text: string }
  | { kind: 'literal'; text: string };

/**
 * Shared SQL scanner: yields executable code vs literals (quotes, comments, dollar-quotes).
 */
function* iterateSqlSegments(sql: string): Generator<SqlSegment> {
  let codeBuffer = '';
  let literalBuffer = '';
  let state: SqlScanState = 'code';
  let dollarTag = '';

  const flushCode = function* (): Generator<SqlSegment> {
    if (codeBuffer) {
      yield { kind: 'code', text: codeBuffer };
      codeBuffer = '';
    }
  };

  const flushLiteral = function* (): Generator<SqlSegment> {
    if (literalBuffer) {
      yield { kind: 'literal', text: literalBuffer };
      literalBuffer = '';
    }
  };

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    const next = i + 1 < sql.length ? sql[i + 1]! : '';

    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        literalBuffer += dollarTag;
        i += dollarTag.length - 1;
        yield* flushLiteral();
        state = 'code';
        dollarTag = '';
      } else {
        literalBuffer += ch;
      }
      continue;
    }

    if (state === 'lineComment') {
      literalBuffer += ch;
      if (ch === '\n') {
        yield* flushLiteral();
        state = 'code';
      }
      continue;
    }

    if (state === 'blockComment') {
      literalBuffer += ch;
      if (ch === '*' && next === '/') {
        literalBuffer += next;
        i += 1;
        yield* flushLiteral();
        state = 'code';
      }
      continue;
    }

    if (state === 'single') {
      literalBuffer += ch;
      if (ch === "'" && next === "'") {
        literalBuffer += next;
        i += 1;
        continue;
      }
      if (ch === "'") {
        yield* flushLiteral();
        state = 'code';
      }
      continue;
    }

    if (state === 'double') {
      literalBuffer += ch;
      if (ch === '"' && next === '"') {
        literalBuffer += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        yield* flushLiteral();
        state = 'code';
      }
      continue;
    }

    // state === 'code'
    if (ch === '-' && next === '-') {
      yield* flushCode();
      literalBuffer += ch + next;
      i += 1;
      state = 'lineComment';
      continue;
    }
    if (ch === '/' && next === '*') {
      yield* flushCode();
      literalBuffer += ch + next;
      i += 1;
      state = 'blockComment';
      continue;
    }
    if (ch === '$') {
      const tag = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)?.[0];
      if (tag) {
        yield* flushCode();
        literalBuffer += tag;
        i += tag.length - 1;
        state = 'dollar';
        dollarTag = tag;
        continue;
      }
    }
    if (ch === "'") {
      yield* flushCode();
      literalBuffer += ch;
      state = 'single';
      continue;
    }
    if (ch === '"') {
      yield* flushCode();
      literalBuffer += ch;
      state = 'double';
      continue;
    }

    codeBuffer += ch;
  }

  yield* flushCode();
  yield* flushLiteral();
}

/**
 * Walk SQL and invoke `transform` only on executable code segments (not literals/comments).
 */
export function transformExecutableSql(sql: string, transform: (code: string) => string): string {
  let out = '';
  for (const segment of iterateSqlSegments(sql)) {
    out += segment.kind === 'code' ? transform(segment.text) : segment.text;
  }
  return out;
}

/**
 * Rewrite SQLite `INSERT OR IGNORE` → Postgres `INSERT … ON CONFLICT DO NOTHING`
 * one executable statement at a time so quoted `;` and `-- POSTGRES:` hints survive.
 */
function rewriteInsertOrIgnoreStatements(sql: string): string {
  if (!/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) return sql;

  const statements = splitExecutableSqlStatements(sql);
  if (statements.length === 0) return sql;

  let changed = false;
  const rewritten = statements.map((statement) => {
    let matched = false;
    let hasConflict = false;
    const next = transformExecutableSql(statement, (code) => {
      if (/\bON\s+CONFLICT\b/i.test(code)) hasConflict = true;
      return code.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, () => {
        matched = true;
        return 'INSERT INTO';
      });
    });
    if (!matched) return statement;
    changed = true;
    if (hasConflict) return next;
    return appendOnConflictDoNothing(next);
  });
  if (!changed) return sql;

  const endsWithSemi = /;\s*$/.test(sql.trimEnd());
  const joined = rewritten.join(';\n\n');
  return endsWithSemi ? `${joined};` : joined;
}

/** Insert ON CONFLICT before trailing `--` comment lines (e.g. `-- POSTGRES:` hints). */
function appendOnConflictDoNothing(statement: string): string {
  const lines = statement.split('\n');
  let firstTrailingComment = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '' || trimmed.startsWith('--')) {
      firstTrailingComment = i;
      continue;
    }
    break;
  }
  const head = lines.slice(0, firstTrailingComment).join('\n').replace(/\s+$/, '');
  const tail = lines.slice(firstTrailingComment).join('\n');
  if (!tail) return `${head} ON CONFLICT DO NOTHING`;
  return `${head} ON CONFLICT DO NOTHING\n${tail}`;
}

/** Split SQL on semicolons that terminate executable statements. */
export function splitExecutableSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';

  const pushStatement = () => {
    const trimmed = current.trim();
    if (!trimmed) {
      current = '';
      return;
    }
    const withoutComments = trimmed
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\S/.test(withoutComments) || /--/.test(trimmed)) {
      statements.push(trimmed);
    }
    current = '';
  };

  for (const segment of iterateSqlSegments(sql)) {
    if (segment.kind === 'literal') {
      current += segment.text;
      continue;
    }

    let i = 0;
    while (i < segment.text.length) {
      const semi = segment.text.indexOf(';', i);
      if (semi === -1) {
        current += segment.text.slice(i);
        break;
      }
      current += segment.text.slice(i, semi);
      pushStatement();
      i = semi + 1;
    }
  }

  pushStatement();
  return statements;
}

const JSON_INSERT_UPDATE_RE =
  /^\s*UPDATE\s+\w+\s+SET\s+content\s*=\s*json_insert\s*\(/i;

function stripJsonInsertUpdateStatements(sql: string): string {
  const statements = splitExecutableSqlStatements(sql);
  if (statements.length === 0) return sql;
  if (!statements.some((statement) => JSON_INSERT_UPDATE_RE.test(statement))) {
    return sql;
  }

  const stripped = statements.map((statement) => {
    if (JSON_INSERT_UPDATE_RE.test(statement)) {
      return '-- (skipped: SQLite json_insert block not supported on Postgres)';
    }
    return statement;
  });

  return `${stripped.join(';\n\n')};\n`;
}

const VMP_SQLITE_ONLY_RE = /\/\*\s*vmp:sqlite-only\s*\*\//i;

/**
 * Drop D1-only statements so -- POSTGRES: peers own the Postgres path.
 * Only strip when the marker appears as a real block comment immediately before
 * the UPDATE (ignore doc mentions inside -- line comments).
 */
function stripVmpSqliteOnlyStatements(sql: string): string {
  const statements = splitExecutableSqlStatements(sql);
  if (statements.length === 0) return sql;
  if (!statements.some((statement) => VMP_SQLITE_ONLY_RE.test(statement))) {
    return sql;
  }

  const stripped = statements.map((statement) => {
    // Remove -- line comments before testing so doc text cannot trigger a strip.
    const withoutLineComments = statement.replace(/--.*$/gm, '');
    if (VMP_SQLITE_ONLY_RE.test(withoutLineComments)) {
      return '-- (skipped: vmp:sqlite-only block; see -- POSTGRES: peer)';
    }
    return statement;
  });

  return `${stripped.join(';\n\n')};\n`;
}

function findMatchingParen(input: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replace `fnName(...)` calls across the full SQL string, skipping matches inside
 * string literals / comments. Must not use transformExecutableSql: empty-string
 * literals (`''`) split code segments and break balanced-paren matching for
 * nested calls like TRIM(COALESCE((SELECT …), '')).
 */
export function replaceSqlFunctionCalls(
  sql: string,
  fnName: string,
  build: (inner: string) => string,
): string {
  const needle = fnName.toLowerCase();
  let out = '';
  let i = 0;
  let state: SqlScanState = 'code';
  let dollarTag = '';

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = i + 1 < sql.length ? sql[i + 1]! : '';

    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        state = 'code';
        dollarTag = '';
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (state === 'lineComment') {
      out += ch;
      i += 1;
      if (ch === '\n') state = 'code';
      continue;
    }

    if (state === 'blockComment') {
      out += ch;
      i += 1;
      if (ch === '*' && next === '/') {
        out += next;
        i += 1;
        state = 'code';
      }
      continue;
    }

    if (state === 'single') {
      out += ch;
      i += 1;
      if (ch === "'" && next === "'") {
        out += next;
        i += 1;
        continue;
      }
      if (ch === "'") state = 'code';
      continue;
    }

    if (state === 'double') {
      out += ch;
      i += 1;
      if (ch === '"' && next === '"') {
        out += next;
        i += 1;
        continue;
      }
      if (ch === '"') state = 'code';
      continue;
    }

    // state === 'code'
    if (ch === '-' && next === '-') {
      out += ch + next;
      i += 2;
      state = 'lineComment';
      continue;
    }
    if (ch === '/' && next === '*') {
      out += ch + next;
      i += 2;
      state = 'blockComment';
      continue;
    }
    if (ch === "'") {
      out += ch;
      i += 1;
      state = 'single';
      continue;
    }
    if (ch === '"') {
      out += ch;
      i += 1;
      state = 'double';
      continue;
    }
    if (ch === '$') {
      const tagMatch = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (tagMatch) {
        dollarTag = tagMatch[0]!;
        out += dollarTag;
        i += dollarTag.length;
        state = 'dollar';
        continue;
      }
    }

    const lowerSlice = sql.slice(i, i + needle.length).toLowerCase();
    if (lowerSlice === needle) {
      const prev = i > 0 ? sql[i - 1]! : '';
      if (!/[A-Za-z0-9_]/.test(prev)) {
        let openIdx = i + needle.length;
        while (openIdx < sql.length && /\s/.test(sql[openIdx]!)) openIdx += 1;
        if (sql[openIdx] === '(') {
          const closeIdx = findMatchingParen(sql, openIdx);
          if (closeIdx !== -1) {
            const inner = sql.slice(openIdx + 1, closeIdx);
            const replacement = build(inner);
            out += replacement;
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

function replaceDateTimeWrapperPatterns(sql: string): string {
  const patterns = [
    {
      start: "strftime('%Y-W%W', datetime(",
      end: '))',
      build: (inner: string) => `to_char((${inner})::timestamptz, 'IYYY-"W"IW')`,
    },
    {
      start: "strftime('%Y-%m', datetime(",
      end: '))',
      build: (inner: string) => `to_char((${inner})::timestamptz, 'YYYY-MM')`,
    },
    {
      start: 'date(datetime(',
      end: '))',
      build: (inner: string) => `((${inner})::timestamptz)::date`,
    },
  ] as const;

  let out = sql;
  for (const pattern of patterns) {
    let cursor = 0;
    for (;;) {
      const startIdx = out.toLowerCase().indexOf(pattern.start.toLowerCase(), cursor);
      if (startIdx === -1) break;
      const openParenIdx = startIdx + pattern.start.length - 1;
      const closeParenIdx = findMatchingParen(out, openParenIdx);
      if (closeParenIdx === -1) break;
      const suffix = out.slice(closeParenIdx + 1, closeParenIdx + 1 + pattern.end.length - 1);
      if (suffix !== pattern.end.slice(1)) {
        cursor = closeParenIdx + 1;
        continue;
      }
      const inner = out.slice(openParenIdx + 1, closeParenIdx).trim();
      const replacement = pattern.build(inner);
      out = out.slice(0, startIdx) + replacement + out.slice(closeParenIdx + pattern.end.length);
      cursor = startIdx + replacement.length;
    }
  }
  return out;
}

/**
 * Uncomment `-- POSTGRES: <sql>` lines in shared D1 migration files.
 * D1 runs the raw SQL (comments are no-ops); api-node expands them for Postgres.
 */
export function expandPostgresOnlyStatements(sql: string): string {
  return sql.replace(/^\s*--\s*POSTGRES:\s*(.+)$/gim, '$1');
}

/** DDL tweaks when applying packages/api/migrations/*.sql to Postgres. */
export function translateSqliteDdl(sql: string): string {
  let s = expandPostgresOnlyStatements(sql);
  s = translateSqliteToPostgres(s);
  s = s.replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ');
  s = s.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY');
  s = s.replace(/\bAUTOINCREMENT\b/gi, 'GENERATED BY DEFAULT AS IDENTITY');
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  s = s.replace(/DEFAULT\s*\(\s*datetime\s*\(\s*'now'\s*\)\s*\)/gi, 'DEFAULT CURRENT_TIMESTAMP');
  // Idempotent DDL for concurrent Deno Deploy boots / retried migrations (D1 files omit IF NOT EXISTS).
  s = s.replace(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/gi, 'CREATE TABLE IF NOT EXISTS ');
  s = s.replace(
    /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/gi,
    (_, unique) => `CREATE ${unique ?? ''}INDEX IF NOT EXISTS `,
  );
  // ADD COLUMN without IF NOT EXISTS fails with 42701 when the column already exists
  // (e.g. migration applied the DDL then crashed before recording _migrations).
  s = s.replace(
    /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi,
    'ADD COLUMN IF NOT EXISTS ',
  );
  return s;
}

/** Postgres duplicate_object / duplicate_table / duplicate_column (SQLSTATE 42P07, 42710, 42701). */
export function isPostgresDuplicateObjectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === '42P07' || code === '42710' || code === '42701';
}
