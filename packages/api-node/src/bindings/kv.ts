import type { SqliteD1Adapter } from './db.js'

type KVGetOptions = { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
type KVPutOptions = { expirationTtl?: number; expiration?: number }

export class SqliteKVAdapter {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly dbAdapter: SqliteD1Adapter) {
    this.ensureTable()
    this.cleanupTimer = setInterval(() => this.purgeExpired(), 60_000)
    this.purgeExpired()
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private ensureTable(): void {
    this.dbAdapter.raw.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at);
    `)
  }

  private purgeExpired(): void {
    try {
      this.dbAdapter.raw
        .prepare('DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at < unixepoch()')
        .run()
    } catch (err) {
      console.error('[kv] expiry cleanup failed:', err)
    }
  }

  async get(
    key: string,
    options?: KVGetOptions | 'text' | 'json' | 'arrayBuffer' | 'stream',
  ): Promise<string | object | null> {
    const type =
      options === 'json'
        ? 'json'
        : typeof options === 'object' && options && 'type' in options
          ? options.type
          : 'text'
    const row = this.dbAdapter.raw
      .prepare('SELECT value, expires_at FROM kv_store WHERE key = ?')
      .get(key) as { value: string; expires_at: number | null } | undefined
    if (!row) return null
    if (row.expires_at != null && row.expires_at < Math.floor(Date.now() / 1000)) {
      this.dbAdapter.raw.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
      return null
    }
    if (type === 'json') {
      try {
        return JSON.parse(row.value) as object
      } catch {
        return null
      }
    }
    return row.value
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream | null, options?: KVPutOptions): Promise<void> {
    if (value == null) {
      await this.delete(key)
      return
    }
    let text: string
    if (typeof value === 'string') {
      text = value
    } else if (value instanceof ArrayBuffer) {
      text = new TextDecoder().decode(value)
    } else if (ArrayBuffer.isView(value)) {
      text = new TextDecoder().decode(value)
    } else {
      const buf = await new Response(value).arrayBuffer()
      text = new TextDecoder().decode(buf)
    }
    let expiresAt: number | null = null
    if (options?.expirationTtl != null) {
      expiresAt = Math.floor(Date.now() / 1000) + options.expirationTtl
    } else if (options?.expiration != null) {
      expiresAt = options.expiration
    }
    this.dbAdapter.raw
      .prepare(
        `INSERT INTO kv_store (key, value, expires_at, created_at)
         VALUES (?, ?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at`,
      )
      .run(key, text, expiresAt)
  }

  async delete(key: string): Promise<void> {
    this.dbAdapter.raw.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
  }

  async list(options?: { prefix?: string | null; limit?: number; cursor?: string | null }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }> {
    const prefix = options?.prefix ?? ''
    const limit = Math.min(options?.limit ?? 1000, 1000)
    const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0
    const rows = this.dbAdapter.raw
      .prepare(
        `SELECT key FROM kv_store
         WHERE key LIKE ? AND (expires_at IS NULL OR expires_at >= unixepoch())
         ORDER BY key LIMIT ? OFFSET ?`,
      )
      .all(`${prefix}%`, limit + 1, offset) as { key: string }[]
    const keys = rows.slice(0, limit).map((r) => ({ name: r.key }))
    const listComplete = rows.length <= limit
    return listComplete
      ? { keys, list_complete: true }
      : { keys, list_complete: false, cursor: String(offset + limit) }
  }

  async getWithMetadata(): Promise<{ value: string | null; metadata: null }> {
    throw new Error('getWithMetadata not implemented in failover KV adapter')
  }
}
