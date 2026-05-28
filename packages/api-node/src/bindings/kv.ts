import { Readable } from 'node:stream'
import { Readable as ReadableStreamNode } from 'node:stream'
import type { PostgresD1Adapter } from './db.js'

type KVGetOptions = { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
type KVPutOptions = { expirationTtl?: number; expiration?: number }

/**
 * KVNamespace shim backed by Postgres (RATE_LIMIT_KV binding).
 * Deno Deploy offers Deno KV natively; we keep a SQL table so @vmp/api code stays unchanged.
 */
export class PostgresKVAdapter {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private readonly ready: Promise<void>

  constructor(private readonly dbAdapter: PostgresD1Adapter) {
    this.ready = this.ensureTable()
    this.cleanupTimer = setInterval(() => {
      void this.purgeExpired()
    }, 60_000)
    void this.purgeExpired()
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private async ensureTable(): Promise<void> {
    await this.dbAdapter.sql`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value BYTEA NOT NULL,
        value_encoding TEXT NOT NULL DEFAULT 'text',
        expires_at BIGINT,
        created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::bigint)
      )
    `
    await this.dbAdapter.sql`
      CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at)
    `
    const cols = await this.dbAdapter.sql<{ name: string }[]>`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kv_store'
    `
    if (!cols.some((c) => c.name === 'value_encoding')) {
      await this.dbAdapter.sql`
        ALTER TABLE kv_store ADD COLUMN value_encoding TEXT NOT NULL DEFAULT 'text'
      `
    }
  }

  private async purgeExpired(): Promise<void> {
    await this.ready
    try {
      await this.dbAdapter.sql`
        DELETE FROM kv_store
        WHERE expires_at IS NOT NULL AND expires_at < EXTRACT(EPOCH FROM NOW())::bigint
      `
    } catch (err) {
      console.error('[kv] expiry cleanup failed:', err)
    }
  }

  private async readRow(key: string): Promise<{
    value: Buffer
    value_encoding: string
    expires_at: number | null
  } | null> {
    await this.ready
    const rows = await this.dbAdapter.sql<
      { value: Buffer; value_encoding: string; expires_at: number | null }[]
    >`
      SELECT value, value_encoding, expires_at FROM kv_store WHERE key = ${key}
    `
    const row = rows[0]
    if (!row) return null
    const value = row.value instanceof Buffer ? row.value : Buffer.from(row.value)
    if (row.expires_at != null && row.expires_at < Math.floor(Date.now() / 1000)) {
      await this.dbAdapter.sql`DELETE FROM kv_store WHERE key = ${key}`
      return null
    }
    return { ...row, value }
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
              ? (options.type ?? 'text')
              : 'text'
    const row = await this.readRow(key)
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
    await this.ready
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

    await this.dbAdapter.sql`
      INSERT INTO kv_store (key, value, value_encoding, expires_at, created_at)
      VALUES (
        ${key},
        ${stored},
        ${encoding},
        ${expiresAt},
        EXTRACT(EPOCH FROM NOW())::bigint
      )
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        value_encoding = EXCLUDED.value_encoding,
        expires_at = EXCLUDED.expires_at
    `
  }

  async delete(key: string): Promise<void> {
    await this.ready
    await this.dbAdapter.sql`DELETE FROM kv_store WHERE key = ${key}`
  }

  async list(options?: { prefix?: string | null; limit?: number; cursor?: string | null }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }> {
    await this.ready
    const prefix = options?.prefix ?? ''
    const limit = Math.min(options?.limit ?? 1000, 1000)
    const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0
    const rows = await this.dbAdapter.sql<{ key: string }[]>`
      SELECT key FROM kv_store
      WHERE key LIKE ${`${prefix}%`}
        AND (expires_at IS NULL OR expires_at >= EXTRACT(EPOCH FROM NOW())::bigint)
      ORDER BY key
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `
    const keys = rows.slice(0, limit).map((r) => ({ name: r.key }))
    const listComplete = rows.length <= limit
    return listComplete
      ? { keys, list_complete: true }
      : { keys, list_complete: false, cursor: String(offset + limit) }
  }

  async getWithMetadata(
    key: string,
    options?: KVGetOptions | 'text' | 'json' | 'arrayBuffer' | 'stream',
  ): Promise<{
    value: string | object | ArrayBuffer | ReadableStream | null
    metadata: null
  }> {
    const type =
      options === 'json'
        ? 'json'
        : options === 'arrayBuffer'
          ? 'arrayBuffer'
          : options === 'stream'
            ? 'stream'
            : typeof options === 'object' && options && 'type' in options
              ? (options.type ?? 'text')
              : 'text'

    const value = await this.get(key, options)
    if (value == null) return { value: null, metadata: null }

    if (type === 'json') {
      if (
        typeof value === 'object' &&
        !(value instanceof ArrayBuffer) &&
        !(value instanceof ReadableStream)
      ) {
        return { value, metadata: null }
      }
      return { value: null, metadata: null }
    }
    if (type === 'arrayBuffer') {
      if (value instanceof ArrayBuffer) return { value, metadata: null }
      return { value: null, metadata: null }
    }
    if (type === 'stream') {
      if (value instanceof ReadableStream) return { value, metadata: null }
      return { value: null, metadata: null }
    }

    if (typeof value === 'string') return { value, metadata: null }
    if (typeof value === 'object' && !(value instanceof ArrayBuffer) && !(value instanceof ReadableStream)) {
      return { value: JSON.stringify(value), metadata: null }
    }
    return { value: null, metadata: null }
  }
}

/** @deprecated Alias */
export type SqliteKVAdapter = PostgresKVAdapter
