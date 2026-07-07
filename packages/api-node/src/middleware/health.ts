import type { CFEnvShape } from '../types.js'
import type { PostgresD1Adapter } from '../bindings/db.js'
import type { ObjectStorageR2BucketBridge } from '@vmp/storage/node'
import type { PostgresKVAdapter } from '../bindings/kv.js'

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthPayload {
  status: HealthStatus
  mode: 'deno-deploy'
  checks: Record<string, unknown>
  timestamp: string
}

export async function buildHealthResponse(env: CFEnvShape): Promise<{ statusCode: number; body: HealthPayload }> {
  const timestamp = new Date().toISOString()
  const checks: Record<string, unknown> = {}

  const db = env.DB as PostgresD1Adapter | undefined
  let databaseOk = false
  if (db) {
    const t0 = Date.now()
    try {
      await db.ping()
      databaseOk = true
      checks.database = { ok: true, latencyMs: Date.now() - t0, backend: 'postgres' }
    } catch (err) {
      checks.database = {
        ok: false,
        latencyMs: Date.now() - t0,
        backend: 'postgres',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    checks.database = { ok: false, error: 'not configured' }
  }

  const bucket = env.BUCKET as ObjectStorageR2BucketBridge | undefined
  const s3TimeoutMs = Number.parseInt(process.env.HEALTH_S3_TIMEOUT_MS ?? '5000', 10) || 5000
  if (bucket?.ping) {
    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const s3 = await Promise.race([
        bucket.ping().then((result) => {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
          return result
        }),
        new Promise<{ ok: false; latencyMs: number; error: string }>((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve({ ok: false, latencyMs: s3TimeoutMs, error: 'timeout' }),
            s3TimeoutMs,
          )
        }),
      ])
      checks.s3 = s3
    } catch (err) {
      checks.s3 = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  } else {
    checks.s3 = { ok: false, error: 'not configured' }
  }

  const kv = env.RATE_LIMIT_KV as PostgresKVAdapter | undefined
  if (kv) {
    const t0 = Date.now()
    try {
      await kv.put('__health_ping__', '1', { expirationTtl: 10 })
      await kv.get('__health_ping__')
      checks.kv = { ok: true, latencyMs: Date.now() - t0, backend: 'postgres-kv' }
    } catch (err) {
      checks.kv = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  } else {
    checks.kv = { ok: false, error: 'not configured' }
  }

  if (db) {
    try {
      checks.writeLogPending = { count: await db.getWriteLogPendingCount(), healthy: true }
    } catch (err) {
      checks.writeLogPending = {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  let status: HealthStatus = 'healthy'
  if (!databaseOk) {
    status = 'unhealthy'
  } else if (!(checks.s3 as { ok?: boolean })?.ok) {
    status = 'degraded'
  } else if (!(checks.writeLogPending as { healthy?: boolean } | undefined)?.healthy && db) {
    status = 'degraded'
  }

  const statusCode = status === 'unhealthy' ? 503 : 200
  return {
    statusCode,
    body: { status, mode: 'deno-deploy', checks, timestamp },
  }
}
