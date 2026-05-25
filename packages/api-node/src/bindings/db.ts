import Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { D1ExecResult, D1Result } from '@cloudflare/workers-types'

const WRITE_SQL_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE)\b/i

export interface SqliteD1Options {
  dbPath: string
  migrationsDir?: string
  enableWriteLog?: boolean
}

function metaFromRun(result: Database.RunResult): D1Result['meta'] {
  return {
    changes: result.changes,
    last_row_id: Number(result.lastInsertRowid),
    duration: 0,
    rows_read: 0,
    rows_written: result.changes,
    changed_db: result.changes > 0,
    size_after: 0,
    served_by: 'failover-sqlite',
  }
}

class SqlitePreparedStatement {
  private readonly stmt: Database.Statement
  private boundArgs: unknown[] = []
  private readonly dbAdapter: SqliteD1Adapter

  constructor(stmt: Database.Statement, dbAdapter: SqliteD1Adapter) {
    this.stmt = stmt
    this.dbAdapter = dbAdapter
  }

  bind(...values: unknown[]): SqlitePreparedStatement {
    this.boundArgs = values
    return this
  }

  private runSync(): Database.RunResult {
    return this.stmt.run(...this.boundArgs) as Database.RunResult
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const row = this.stmt.get(...this.boundArgs) as Record<string, unknown> | undefined
    if (!row) return null
    if (colName !== undefined) {
      return (row[colName] as T) ?? null
    }
    return row as T
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = this.stmt.all(...this.boundArgs) as T[]
    return {
      results,
      success: true,
      meta: metaFromRun({ changes: 0, lastInsertRowid: 0 } as Database.RunResult),
    }
  }

  async run(): Promise<D1Result> {
    return this.runAsD1Result()
  }

  /** Used by SqliteD1Adapter.batch for transactional writes. */
  runAsD1Result(): D1Result {
    const sql = String(this.stmt.source)
    const result = this.runSync()
    if (WRITE_SQL_RE.test(sql)) {
      this.dbAdapter.logWrite(sql, this.boundArgs)
    }
    return {
      results: [],
      success: true,
      meta: metaFromRun(result),
    }
  }
}

export class SqliteD1Adapter {
  private db: Database.Database
  private readonly dbPath: string
  private readonly enableWriteLog: boolean
  private writeLogStmt: Database.Statement | null = null

  constructor(options: SqliteD1Options) {
    this.dbPath = resolve(options.dbPath)
    this.enableWriteLog = options.enableWriteLog !== false
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.ensureWriteLogTable()
    if (options.migrationsDir) {
      this.runMigrations(options.migrationsDir)
    }
  }

  get raw(): Database.Database {
    return this.db
  }

  get path(): string {
    return this.dbPath
  }

  prepare(sql: string): SqlitePreparedStatement {
    const stmt = this.db.prepare(sql)
    return new SqlitePreparedStatement(stmt, this)
  }

  async batch(statements: SqlitePreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = []
    const transaction = this.db.transaction(() => {
      for (const statement of statements) {
        results.push(statement.runAsD1Result())
      }
    })
    transaction()
    return results
  }

  async exec(sql: string): Promise<D1ExecResult> {
    this.db.exec(sql)
    return { count: 0, duration: 0 }
  }

  /** Replace the on-disk database file and reconnect (used after D1 sync). */
  reconnect(newPath?: string): void {
    this.db.close()
    const path = newPath ? resolve(newPath) : this.dbPath
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.ensureWriteLogTable()
  }

  close(): void {
    this.db.close()
  }

  countTableRows(): Record<string, number> {
    const tables = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[]
    const counts: Record<string, number> = {}
    for (const { name } of tables) {
      if (name === 'failover_write_log' || name === '_migrations' || name === 'kv_store') continue
      try {
        const row = this.db.prepare(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, '""')}"`).get() as { c: number }
        counts[name] = row.c
      } catch {
        counts[name] = -1
      }
    }
    return counts
  }

  getWriteLogPendingCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM failover_write_log').get() as { c: number }
    return row.c
  }

  listWriteLog(limit = 500): { id: number; sql: string; params_json: string; created_at: string }[] {
    return this.db
      .prepare(
        `SELECT id, sql, params_json, created_at FROM failover_write_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as { id: number; sql: string; params_json: string; created_at: string }[]
  }

  exportWriteLogSql(): string {
    const rows = this.db
      .prepare('SELECT id, sql, params_json, created_at FROM failover_write_log ORDER BY id ASC')
      .all() as { id: number; sql: string; params_json: string; created_at: string }[]
    const lines = [
      '-- VMP failover write log export',
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

  private ensureWriteLogTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS failover_write_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sql TEXT NOT NULL,
        params_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    this.writeLogStmt = this.db.prepare(
      'INSERT INTO failover_write_log (sql, params_json) VALUES (?, ?)',
    )
  }

  logWrite(sql: string, params: unknown[]): void {
    if (!this.enableWriteLog || !this.writeLogStmt) return
    if (/failover_write_log/i.test(sql)) return
    try {
      this.writeLogStmt.run(sql.trim(), JSON.stringify(params))
    } catch (err) {
      console.error('[failover] write log insert failed:', err)
    }
  }

  private runMigrations(migrationsDir: string): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    const applied = new Set(
      (this.db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id),
    )
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of files) {
      const id = file.replace(/\.sql$/, '')
      if (applied.has(id)) continue
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      const run = this.db.transaction(() => {
        this.db.exec(sql)
        this.db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(id)
      })
      run()
      console.log(`[migrations] applied ${file}`)
    }
  }
}

export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../api/migrations')
}
