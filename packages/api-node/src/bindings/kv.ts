import { Readable } from 'node:stream'
import { Readable as ReadableStreamNode } from 'node:stream'
import type { SqliteD1Adapter } from './db.js'

type KVGetOptions = { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
type KVPutOptions = { expirationTtl?: number; expiration?: number }

type StoredRow = {
  value: Buffer
  value_encoding: string
  expires_at: number | null
}

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
        value BLOB NOT NULL,
        value_encoding TEXT NOT NULL DEFAULT 'text',
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at);
    `)
    const cols = this.dbAdapter.raw.prepare(`PRAGMA table_info(kv_store)`).all() as { name: string }[]
    if (!cols.some((c) => c.name === 'value_encoding')) {
      this.dbAdapter.raw.exec(`ALTER TABLE kv_store ADD COLUMN value_encoding TEXT NOT NULL DEFAULT 'text'`)
    }
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

  private readRow(key: string): StoredRow | null {
    const row = this.dbAdapter.raw
      .prepare('SELECT value, value_encoding, expires_at FROM kv_store WHERE key = ?')
      .get(key) as StoredRow | undefined
    if (!row) return null
    if (!(row.value instanceof Buffer)) {
      row.value = Buffer.from(row.value as unknown as ArrayBuffer)
    }
    if (row.expires_at != null && row.expires_at < Math.floor(Date.now() / 1000)) {
      this.dbAdapter.raw.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
      return null
    }
    return row
  }

  async get(
    key: string,
    options?: KVGetOptions | 'text' | 'json' | 'arrayBuffer' | 'stream',
  ): Promise<string | object | ArrayBuffer | ReadableStream | null> {
    const type =
      options === 'json'
        ? 'json'
        : options === 'arrayBuffer'
          ? 'arrayBuffer'
          : options === 'stream'
            ? 'stream'
            : typeof options === 'object' && options && 'type' in options
              ? options.type ?? 'text'
              : 'text'
    const row = this.readRow(key)
    if (!row) return null

    if (type === 'json') {
      if (row.value_encoding === 'binary') return null
      try {
        return JSON.parse(row.value.toString('utf8')) as object
      } catch {
        return null
      }
    }
    if (type === 'arrayBuffer') {
      const buf = row.value
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
    if (type === 'stream') {
      const nodeStream = Readable.from(row.value)
      return ReadableStreamNode.toWeb(nodeStream) as ReadableStream
    }
    if (row.value_encoding === 'binary') {
      return row.value.toString('utf8')
    }
    return row.value.toString('utf8')
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | null,
    options?: KVPutOptions,
  ): Promise<void> {
    if (value == null) {
      await this.delete(key)
      return
    }

    let stored: Buffer
    let encoding: 'text' | 'binary' = 'text'
    if (typeof value === 'string') {
      stored = Buffer.from(value, 'utf8')
    } else if (value instanceof ArrayBuffer) {
      stored = Buffer.from(value)
      encoding = 'binary'
    } else if (ArrayBuffer.isView(value)) {
      stored = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      encoding = 'binary'
    } else {
      const buf = Buffer.from(await new Response(value).arrayBuffer())
      stored = buf
      encoding = 'binary'
    }

    let expiresAt: number | null = null
    if (options?.expirationTtl != null) {
      expiresAt = Math.floor(Date.now() / 1000) + options.expirationTtl
    } else if (options?.expiration != null) {
      expiresAt = options.expiration
    }
    this.dbAdapter.raw
      .prepare(
        `INSERT INTO kv_store (key, value, value_encoding, expires_at, created_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           value_encoding = excluded.value_encoding,
           expires_at = excluded.expires_at`,
      )
      .run(key, stored, encoding, expiresAt)
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

  async getWithMetadata(
    key: string,
    options?: KVGetOptions | 'text' | 'json' | 'arrayBuffer' | 'stream',
  ): Promise<{ value: string | null; metadata: null }> {
    const value = await this.get(key, options)
    if (value == null) return { value: null, metadata: null }
    if (typeof value === 'string') return { value, metadata: null }
    if (typeof value === 'object' && !(value instanceof ArrayBuffer) && !(value instanceof ReadableStream)) {
      return { value: JSON.stringify(value), metadata: null }
    }
    return { value: null, metadata: null }
  }
}
