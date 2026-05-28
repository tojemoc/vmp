import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import type { D1ExecResult, D1Result } from '@cloudflare/workers-types'
import { bindQuestionMarks, translateSqliteDdl, translateSqliteToPostgres } from './sqlDialect.js'

const WRITE_SQL_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE)\b/i

export interface PostgresD1Options {
  /** Injected by Deno Deploy when a managed Postgres database is attached. */
  databaseUrl: string
  migrationsDir?: string
  enableWriteLog?: boolean
  /** Keep low for Deno Deploy serverless workers. */
  maxConnections?: number
}

function metaFromRun(changes: number, lastRowId: number): D1Result['meta'] {
  return {
    changes,
    last_row_id: lastRowId,
    duration: 0,
    rows_read: 0,
    rows_written: changes,
    changed_db: changes > 0,
    size_after: 0,
    served_by: 'deno-deploy-postgres',
  }
}

type SqlParams = Parameters<Sql['unsafe']>[1]

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false
  let inDollarQuote = false
  let currentDollarTag = ''

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : ''

    if (inDollarQuote) {
      if (sql.startsWith(currentDollarTag, i)) {
        current += currentDollarTag
        i += currentDollarTag.length - 1
        inDollarQuote = false
        currentDollarTag = ''
      } else {
        current += char
      }
      continue
    }

    if (inLineComment) {
      current += char
      if (char === '\n') inLineComment = false
      continue
    }

    if (inBlockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += next
        i += 1
        inBlockComment = false
      }
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        current += char + next
        i += 1
        inLineComment = true
        continue
      }
      if (char === '/' && next === '*') {
        current += char + next
        i += 1
        inBlockComment = true
        continue
      }
      if (char === '$') {
        const maybeTag = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)?.[0]
        if (maybeTag) {
          current += maybeTag
          i += maybeTag.length - 1
          inDollarQuote = true
          currentDollarTag = maybeTag
          continue
        }
      }
    }

    if (!inDoubleQuote && char === "'" && !(inSingleQuote && next === "'")) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }
    if (inSingleQuote && char === "'" && next === "'") {
      current += char + next
      i += 1
      continue
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if (!inSingleQuote && !inDoubleQuote && char === ';') {
      const trimmed = current.trim()
      if (trimmed && /\S/.test(trimmed.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
        statements.push(trimmed)
      }
      current = ''
      continue
    }

    current += char
  }

  const finalStatement = current.trim()
  if (
    finalStatement &&
    /\S/.test(finalStatement.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
  ) {
    statements.push(finalStatement)
  }
  return statements
}

function translateAndBind(sql: string, params: unknown[]): { text: string; values: SqlParams } {
  const translated = translateSqliteToPostgres(sql)
  const text = bindQuestionMarks(translated, params.length)
  return { text, values: params as SqlParams }
}

async function runOnSql(
  sqlHandle: Sql,
  sourceSql: string,
  boundArgs: unknown[],
): Promise<{ changes: number; lastRowId: number }> {
  const { text, values } = translateAndBind(sourceSql, boundArgs)
  const isWrite = WRITE_SQL_RE.test(sourceSql)

  if (!isWrite) {
    await sqlHandle.unsafe(text, values)
    return { changes: 0, lastRowId: 0 }
  }

  const result = await sqlHandle.unsafe(text, values)
  return { changes: result.count, lastRowId: 0 }
}

export class PostgresPreparedStatement {
  readonly sourceSql: string
  private boundArgs: unknown[] = []
  private readonly dbAdapter: PostgresD1Adapter

  constructor(sourceSql: string, dbAdapter: PostgresD1Adapter) {
    this.sourceSql = sourceSql
    this.dbAdapter = dbAdapter
  }

  bind(...values: unknown[]): PostgresPreparedStatement {
    this.boundArgs = values
    return this
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const rows = await this.executeRows<Record<string, unknown>>()
    if (rows.length === 0) return null
    const row = rows[0]!
    if (colName !== undefined) {
      return (row[colName] as T) ?? null
    }
    return row as T
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = await this.executeRows<T>()
    return {
      results,
      success: true,
      meta: metaFromRun(0, 0),
    }
  }

  async run(): Promise<D1Result> {
    return this.runAsD1Result(this.dbAdapter.sql)
  }

  /** Used by PostgresD1Adapter.batch inside a transaction. */
  async runAsD1Result(sqlHandle?: Sql): Promise<D1Result> {
    const handle = sqlHandle ?? this.dbAdapter.sql
    const { changes, lastRowId } = await runOnSql(handle, this.sourceSql, this.boundArgs)
    if (WRITE_SQL_RE.test(this.sourceSql)) {
      this.dbAdapter.logWrite(this.sourceSql, this.boundArgs)
    }
    return {
      results: [],
      success: true,
      meta: metaFromRun(changes, lastRowId),
    }
  }

  private async executeRows<T>(sqlHandle?: Sql): Promise<T[]> {
    const handle = sqlHandle ?? this.dbAdapter.sql
    const { text, values } = translateAndBind(this.sourceSql, this.boundArgs)
    return (await handle.unsafe(text, values)) as T[]
  }
}

export class PostgresD1Adapter {
  readonly sql: Sql
  private readonly enableWriteLog: boolean
  private closed = false

  constructor(options: PostgresD1Options) {
    // postgres.js is pure JS (no native .node bindings) — required on Deno Deploy.
    this.sql = postgres(options.databaseUrl, {
      max: options.maxConnections ?? 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
    this.enableWriteLog = options.enableWriteLog !== false
  }

  /** Open pool, apply SQL migrations, and ensure auxiliary tables exist. */
  async init(migrationsDir?: string): Promise<void> {
    await this.ping()
    await this.ensureWriteLogTable()
    if (migrationsDir) {
      await this.runMigrations(migrationsDir)
    }
  }

  get raw(): Sql {
    return this.sql
  }

  prepare(sql: string): PostgresPreparedStatement {
    return new PostgresPreparedStatement(sql, this)
  }

  async batch(statements: PostgresPreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = []
    await this.sql.begin(async (tx) => {
      for (const statement of statements) {
        results.push(await statement.runAsD1Result(tx as unknown as Sql))
      }
    })
    return results
  }

  async exec(sql: string): Promise<D1ExecResult> {
    const chunks = splitSqlStatements(sql)
    for (const chunk of chunks) {
      const translated = translateSqliteToPostgres(chunk)
      await this.sql.unsafe(translated)
    }
    return { count: chunks.length, duration: 0 }
  }

  async ping(): Promise<void> {
    await this.sql`SELECT 1`
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.sql.end({ timeout: 5 })
  }

  async countTableRows(): Promise<Record<string, number>> {
    const tables = await this.sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `
    const counts: Record<string, number> = {}
    for (const { table_name } of tables) {
      if (table_name === 'failover_write_log' || table_name === '_migrations' || table_name === 'kv_store') {
        continue
      }
      try {
        const rows = await this.sql.unsafe(
          `SELECT COUNT(*)::int AS c FROM "${table_name.replace(/"/g, '""')}"`,
        )
        counts[table_name] = Number((rows[0] as { c: number } | undefined)?.c ?? -1)
      } catch {
        counts[table_name] = -1
      }
    }
    return counts
  }

  async getWriteLogPendingCount(): Promise<number> {
    try {
      const rows = await this.sql<{ c: number }[]>`
        SELECT COUNT(*)::int AS c FROM failover_write_log
      `
      return rows[0]?.c ?? 0
    } catch {
      return 0
    }
  }

  async listWriteLog(
    limit = 500,
  ): Promise<{ id: number; sql: string; params_json: string; created_at: string }[]> {
    return this.sql`
      SELECT id, sql, params_json, created_at::text
      FROM failover_write_log
      ORDER BY id DESC
      LIMIT ${limit}
    `
  }

  async exportWriteLogSql(): Promise<string> {
    const rows = await this.sql<
      { id: number; sql: string; params_json: string; created_at: string }[]
    >`
      SELECT id, sql, params_json, created_at::text
      FROM failover_write_log
      ORDER BY id ASC
    `
    const lines = [
      '-- VMP write log export',
      `-- generated_at: ${new Date().toISOString()}`,
      `-- entries: ${rows.length}`,
      '',
    ]
    for (const row of rows) {
      lines.push(`-- id=${row.id} created_at=${row.created_at}`)
      lines.push(`-- params: ${row.params_json}`)
      lines.push(row.sql)
      lines.push('')
    }
    return lines.join('\n')
  }

  private async ensureWriteLogTable(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS failover_write_log (
        id BIGSERIAL PRIMARY KEY,
        sql TEXT NOT NULL,
        params_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
  }

  logWrite(sql: string, params: unknown[]): void {
    if (!this.enableWriteLog) return
    if (/failover_write_log/i.test(sql)) return
    const trimmed = sql.trim()
    const { text, values } = translateAndBind(trimmed, params)
    void this.sql
      .unsafe(`INSERT INTO failover_write_log (sql, params_json) VALUES ($1, $2)`, [
        text,
        JSON.stringify(values),
      ])
      .catch((err) => {
        console.error('[db] write log insert failed:', err)
      })
  }

  private async runMigrations(migrationsDir: string): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `

    const appliedRows = await this.sql<{ id: string }[]>`SELECT id FROM _migrations`
    const applied = new Set(appliedRows.map((r) => r.id))

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const id = file.replace(/\.sql$/, '')
      if (applied.has(id)) continue
      const raw = readFileSync(join(migrationsDir, file), 'utf8')
      const sql = translateSqliteDdl(raw)
      await this.sql.begin(async (tx) => {
        const statements = splitSqlStatements(sql)
        for (const statement of statements) {
          await tx.unsafe(statement)
        }
        await tx`INSERT INTO _migrations (id) VALUES (${id})`
      })
      console.log(`[migrations] applied ${file}`)
    }
  }
}

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (set by Deno Deploy when a managed Postgres database is attached)',
    )
  }
  return url
}

/** @deprecated Alias — api-node now uses Postgres only. */
export type SqliteD1Adapter = PostgresD1Adapter
