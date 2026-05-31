export const REPLICATION_INGEST_PATH = '/api/internal/replication/ingest'

export type ReplicationIngestResult = {
  ok: boolean
  applied: number
  skipped: number
  errors: { eventId?: string; stream?: string; error: string }[]
}

/** Normalize Worker secret URL to the Deno api-node ingest endpoint. */
export function resolveReplicationTargetUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '') || ''
    if (!path || path === '/') {
      url.pathname = REPLICATION_INGEST_PATH
    } else if (path === '/api/internal/replication' || path.endsWith('/replication')) {
      url.pathname = REPLICATION_INGEST_PATH
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

export function describeReplicationTarget(raw: string): {
  configured: boolean
  ingestPathOk: boolean
  resolvedPath: string
  warning?: string
} {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) {
    return { configured: false, ingestPathOk: false, resolvedPath: '' }
  }

  const resolved = resolveReplicationTargetUrl(trimmed)
  let resolvedPath = ''
  let ingestPathOk = false
  let warning: string | undefined

  try {
    const url = new URL(resolved)
    resolvedPath = url.pathname
    ingestPathOk = url.pathname === REPLICATION_INGEST_PATH
    const host = url.hostname.toLowerCase()
    if (host.endsWith('.workers.dev')) {
      warning =
        'REPLICATION_TARGET_URL points at a Cloudflare Workers host. Use your Deno Deploy api-node URL with /api/internal/replication/ingest.'
    }
  } catch {
    warning = 'REPLICATION_TARGET_URL is not a valid URL.'
  }

  if (!ingestPathOk && !warning) {
    warning = `REPLICATION_TARGET_URL must end with ${REPLICATION_INGEST_PATH} (Deno api-node ingest).`
  }

  return { configured: true, ingestPathOk, resolvedPath, warning }
}

export function parseReplicationIngestResponse(bodyText: string): ReplicationIngestResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return { ok: false, applied: 0, skipped: 0, errors: [{ error: 'Invalid JSON from replication target' }] }
  }
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const errors = Array.isArray(record.errors)
    ? record.errors.map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      return {
        eventId: row.eventId != null ? String(row.eventId) : undefined,
        stream: row.stream != null ? String(row.stream) : undefined,
        error: String(row.error ?? 'unknown'),
      }
    })
    : []
  return {
    ok: record.ok === true,
    applied: Number(record.applied) || 0,
    skipped: Number(record.skipped) || 0,
    errors,
  }
}

export function assertReplicationIngestAccepted(
  result: ReplicationIngestResult,
  eventCount: number,
): void {
  if (result.errors.length > 0) {
    const first = result.errors[0]
    throw new Error(
      `Replication ingest reported errors (${result.errors.length}): ${first.error}${first.stream ? ` [${first.stream}]` : ''}`,
    )
  }
  if (eventCount > 0 && result.applied === 0 && result.skipped === eventCount) {
    throw new Error(
      'Replication ingest skipped all events (check replication_mode is d1_to_pg and Postgres migrations on Deno)',
    )
  }
  if (eventCount > 0 && result.applied === 0 && result.skipped < eventCount) {
    throw new Error('Replication ingest applied 0 rows; target may be misconfigured or database unavailable')
  }
}

export function replicationTargetProbeHint(status: number, bodyText: string): string | undefined {
  if (status === 404 && bodyText.includes('Not Found')) {
    return 'Ingest returned 404 Not Found — REPLICATION_TARGET_URL likely points at the Cloudflare Worker API instead of Deno api-node /api/internal/replication/ingest.'
  }
  if (status === 401) {
    return 'Ingest returned 401 — REPLICATION_TARGET_TOKEN does not match Deno REPLICATION_INGEST_TOKEN.'
  }
  if (status === 503 && bodyText.includes('not configured')) {
    return 'Ingest returned 503 — set REPLICATION_INGEST_TOKEN on Deno Deploy (api-node).'
  }
  return undefined
}
