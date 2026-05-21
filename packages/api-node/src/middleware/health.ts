import type { CFEnvShape } from '../types.js'
import { getLastD1SyncState } from '../sync/d1sync.js'
import type { SqliteD1Adapter } from '../bindings/db.js'
import type { S3R2Adapter } from '../bindings/bucket.js'
import type { SqliteKVAdapter } from '../bindings/kv.js'

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthPayload {
  status: HealthStatus
  mode: 'failover'
  checks: Record<string, unknown>
  timestamp: string
}

export async function buildHealthResponse(env: CFEnvShape): Promise<{ statusCode: number; body: HealthPayload }> {
  const timestamp = new Date().toISOString()
  const checks: Record<string, unknown> = {}

  const db = env.DB as SqliteD1Adapter | undefined
  let databaseOk = false
  let dbLatency = 0
  if (db) {
    const t0 = Date.now()
    try {
      db.raw.prepare('SELECT 1').get()
      databaseOk = true
      dbLatency = Date.now() - t0
      checks.database = { ok: true, latencyMs: dbLatency }
    } catch (err) {
      checks.database = {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    checks.database = { ok: false, error: 'not configured' }
  }

  const bucket = env.BUCKET as S3R2Adapter | undefined
  if (bucket?.ping) {
    const s3 = await bucket.ping()
    checks.s3 = s3
  } else {
    checks.s3 = { ok: false, error: 'not configured' }
  }

  const kv = env.RATE_LIMIT_KV as SqliteKVAdapter | undefined
  if (kv) {
    const t0 = Date.now()
    try {
      await kv.put('__health_ping__', '1', { expirationTtl: 10 })
      await kv.get('__health_ping__')
      checks.kv = { ok: true, latencyMs: Date.now() - t0 }
    } catch (err) {
      checks.kv = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  } else {
    checks.kv = { ok: false, error: 'not configured' }
  }

  const syncState = getLastD1SyncState()
  if (syncState.lastSyncAt) {
    const ageSeconds = Math.floor((Date.now() - new Date(syncState.lastSyncAt).getTime()) / 1000)
    checks.lastD1Sync = {
      ok: ageSeconds < 600,
      ageSeconds,
      rowCounts: syncState.lastRowCounts,
      bookmark: syncState.lastBookmark,
    }
  } else {
    checks.lastD1Sync = { ok: false, error: 'no sync completed yet' }
  }

  if (db) {
    checks.writeLogPending = { count: db.getWriteLogPendingCount() }
  }

  let status: HealthStatus = 'healthy'
  if (!databaseOk) {
    status = 'unhealthy'
  } else if (!(checks.s3 as { ok?: boolean })?.ok) {
    status = 'degraded'
  } else if (!(checks.lastD1Sync as { ok?: boolean })?.ok) {
    status = 'degraded'
  }

  const statusCode = status === 'unhealthy' ? 503 : 200
  return {
    statusCode,
    body: { status, mode: 'failover', checks, timestamp },
  }
}
