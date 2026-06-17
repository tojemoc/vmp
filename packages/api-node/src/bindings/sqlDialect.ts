/**
 * Translates D1/SQLite SQL (used by @vmp/api) into PostgreSQL for Deno Deploy managed SQL.
 * Deno Deploy cannot load native addons (better-sqlite3); the Worker code stays unchanged.
 */

/** Split SQL on `?` placeholders outside string literals (for postgres.js tagged templates). */
export function splitQuestionMarks(sql: string): string[] {
  const parts: string[] = ['']
  let partIndex = 0
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!
    const nextCh = sql[i + 1]
    if (ch === "'" && !inDouble) {
      if (nextCh === "'") {
        parts[partIndex]! += "''"
        i += 1
        continue
      }
      inSingle = !inSingle
      parts[partIndex]! += ch
      continue
    }
    if (ch === '"' && !inSingle) {
      if (nextCh === '"') {
        parts[partIndex]! += '""'
        i += 1
        continue
      }
      inDouble = !inDouble
      parts[partIndex]! += ch
      continue
    }
    if (ch === '?' && !inSingle && !inDouble) {
      parts.push('')
      partIndex += 1
      continue
    }
    parts[partIndex]! += ch
  }
  return parts
}

/** Replace `?` placeholders outside string literals with `$1`, `$2`, … */
export function bindQuestionMarks(sql: string, paramCount: number): string {
  if (paramCount === 0) return sql
  let index = 0
  let out = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const nextCh = sql[i + 1]
    if (ch === "'" && !inDouble) {
      if (nextCh === "'") {
        out += "''"
        i += 1
        continue
      }
      inSingle = !inSingle
      out += ch
      continue
    }
    if (ch === '"' && !inSingle) {
      if (nextCh === '"') {
        out += '""'
        i += 1
        continue
      }
      inDouble = !inDouble
      out += ch
      continue
    }
    if (ch === '?' && !inSingle && !inDouble) {
      index += 1
      if (index > paramCount) {
        throw new Error(`SQL has more ? placeholders than bound parameters (${paramCount})`)
      }
      out += `$${index}`
      continue
    }
    out += ch
  }
  if (index !== paramCount) {
    throw new Error(`SQL has ${index} ? placeholders but ${paramCount} parameters were bound`)
  }
  return out
}

/** Runtime + migration SQL dialect tweaks (SQLite → PostgreSQL). */
export function translateSqliteToPostgres(sql: string): string {
  let s = sql.trim()

  // Strip SQLite PRAGMA (Postgres uses different session settings).
  s = s.replace(/^\s*PRAGMA\s+[^;]+;\s*/gim, '')

  // sqlite_master introspection (admin health / seed helpers in @vmp/api).
  s = s.replace(
    /FROM\s+sqlite_master\b/gi,
    "FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  )
  s = s.replace(/\btype\s*=\s*'table'/gi, "table_type = 'BASE TABLE'")

  // PRAGMA table_info(tbl) → information_schema (used by brevo + kv bootstrap).
  s = s.replace(/PRAGMA\s+table_info\s*\(\s*([`'"]?)(\w+)\1\s*\)/gi, (_m, _q, table) => {
    return `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`
  })

  const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(s)

  // DML compatibility
  s = s.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
  s = s.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO')
  s = s.replace(/\bREPLACE\s+INTO\b/gi, 'INSERT INTO')

  // Postgres requires ON CONFLICT for ignore semantics (SQLite INSERT OR IGNORE).
  if (hadInsertOrIgnore && /\bINSERT\s+INTO\b/i.test(s) && !/\bON\s+CONFLICT\b/i.test(s)) {
    s = `${s.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`
  }

  // datetime('now', modifier) — SQLite modifier strings
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+seconds'\s*\)/gi,
    (_m, sec) => `(CURRENT_TIMESTAMP + interval '${sec} seconds')`,
  )
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+hours'\s*\)/gi,
    (_m, hrs) => `(CURRENT_TIMESTAMP - interval '${hrs} hours')`,
  )
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'\+(\d+)\s+minutes'\s*\)/gi,
    (_m, min) => `(CURRENT_TIMESTAMP + interval '${min} minutes')`,
  )
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')

  // datetime(column, modifier) — brevo claim timeouts
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*\?\s*\)/gi,
    "(CURRENT_TIMESTAMP + (?::text || ' seconds')::interval)",
  )
  s = s.replace(
    /datetime\s*\(\s*created_at\s*,\s*\?\s*\)/gi,
    "(created_at::timestamptz + (?::text || ' seconds')::interval)",
  )

  // datetime(?) — replication cursors, analytics date filters (before column-name pass)
  s = s.replace(/datetime\s*\(\s*\?\s*\)/gi, '(?::timestamptz)')

  // datetime(expr) comparisons — treat text timestamps as timestamptz
  s = s.replace(/datetime\s*\(\s*([a-zA-Z0-9_.]+)\s*\)/g, '($1::timestamptz)')

  s = s.replace(/\bunixepoch\s*\(\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::bigint')
  s = s.replace(
    /\bunixepoch\s*\(\s*\)\s*<\s*unixepoch\s*\(\s*\)/gi,
    'EXTRACT(EPOCH FROM NOW()) < EXTRACT(EPOCH FROM NOW())',
  )
  s = s.replace(
    /expires_at\s*<\s*unixepoch\s*\(\s*\)/gi,
    'expires_at < EXTRACT(EPOCH FROM NOW())::bigint',
  )
  s = s.replace(
    /expires_at\s*>=\s*unixepoch\s*\(\s*\)/gi,
    'expires_at >= EXTRACT(EPOCH FROM NOW())::bigint',
  )
  s = s.replace(/\bunixepoch\s*\(\s*\)/gi, 'EXTRACT(EPOCH FROM NOW())::bigint')

  // strftime/date analytics transforms with nested datetime(...) support.
  s = replaceDateTimeWrapperPatterns(s)

  // Catch any remaining SQLite datetime(...) Postgres does not implement.
  s = s.replace(/datetime\s*\(\s*([^)]+)\s*\)/gi, (_match, inner) => {
    const expr = inner.trim()
    if (/^'now'/i.test(expr)) return 'CURRENT_TIMESTAMP'
    if (/^CURRENT_TIMESTAMP$/i.test(expr)) return 'CURRENT_TIMESTAMP'
    return `(${expr}::timestamptz)`
  })

  // SQLite trim() accepts any type; Postgres trim/btrim is text-only (TIMESTAMPTZ → 42883).
  s = s.replace(/\btrim\s*\(\s*([^)]+)\s*\)/gi, 'btrim(($1)::text)')

  // SQLite implicit rowid (e.g. migration 0029 dedup) → Postgres ctid system column.
  s = s.replace(/\browid\b/gi, 'ctid')

  return s
}

function findMatchingParen(input: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < input.length; i++) {
    const ch = input[i]
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
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
  ] as const

  let out = sql
  for (const pattern of patterns) {
    let cursor = 0
    for (;;) {
      const startIdx = out.toLowerCase().indexOf(pattern.start.toLowerCase(), cursor)
      if (startIdx === -1) break
      const openParenIdx = startIdx + pattern.start.length - 1
      const closeParenIdx = findMatchingParen(out, openParenIdx)
      if (closeParenIdx === -1) break
      const suffix = out.slice(closeParenIdx + 1, closeParenIdx + 1 + pattern.end.length - 1)
      if (suffix !== pattern.end.slice(1)) {
        cursor = closeParenIdx + 1
        continue
      }
      const inner = out.slice(openParenIdx + 1, closeParenIdx).trim()
      const replacement = pattern.build(inner)
      out = out.slice(0, startIdx) + replacement + out.slice(closeParenIdx + pattern.end.length)
      cursor = startIdx + replacement.length
    }
  }
  return out
}

/** DDL tweaks when applying packages/api/migrations/*.sql to Postgres. */
export function translateSqliteDdl(sql: string): string {
  let s = translateSqliteToPostgres(sql)
  s = s.replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
  s = s.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
  s = s.replace(/\bAUTOINCREMENT\b/gi, 'GENERATED BY DEFAULT AS IDENTITY')
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
  s = s.replace(/DEFAULT\s*\(\s*datetime\s*\(\s*'now'\s*\)\s*\)/gi, 'DEFAULT CURRENT_TIMESTAMP')
  // Idempotent DDL for concurrent Deno Deploy boots / retried migrations (D1 files omit IF NOT EXISTS).
  s = s.replace(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/gi, 'CREATE TABLE IF NOT EXISTS ')
  s = s.replace(
    /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/gi,
    (_, unique) => `CREATE ${unique ?? ''}INDEX IF NOT EXISTS `,
  )
  return s
}

/** Postgres duplicate_object / duplicate_table (SQLSTATE 42P07, 42710). */
export function isPostgresDuplicateObjectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === '42P07' || code === '42710'
}
