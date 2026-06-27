/**
 * Structured application logs.
 *
 * Always emitted to `console.log` (visible in the Cloudflare dashboard and
 * Workers Logpush when that plan feature is enabled).
 *
 * Optional direct shipping to Datadog via the HTTP Logs API when configured:
 *   DD_LOGS_ENABLED=true
 *   DD_API_KEY=<secret>          — wrangler secret put DD_API_KEY
 *   DD_SITE=datadoghq.eu         — optional, default datadoghq.eu
 *   DD_SERVICE=vmp-api           — optional Datadog service name
 *   DD_ENV=staging               — optional tag (env:staging)
 *   DD_VERSION=abc123            — optional tag (version:…); falls back to CF_VERSION_METADATA.id
 *
 * Wrap each Worker entry point (fetch / scheduled / queue) in
 * `runWithDatadogLogContext(env, ctx, fn)` so batched uploads use `ctx.waitUntil`.
 *
 * In Datadog Logs Explorer, search: `source:cloudflare-worker service:vmp-api`
 * Filter by attributes: `@event:route_not_found`, `@component:worker`, `@http_status:404`.
 */

/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks'

type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  service: string
  event: string
  level?: LogLevel
  duration_ms?: number
  http_method?: string
  http_path?: string
  http_status?: number
  video_id?: string
  user_id_hash?: string
  error_code?: string
  error_message?: string
  [key: string]: unknown
}

type LogEntry = LogFields & {
  level: LogLevel
  ts: string
}

type DatadogLogContext = {
  env: Record<string, unknown>
  ctx: ExecutionContext
  buffer: LogEntry[]
}

const datadogLogContextStorage = new AsyncLocalStorage<DatadogLogContext>()

type DatadogFlushHandler = (env: Record<string, unknown>, entries: LogEntry[]) => Promise<void>

let datadogFlushHandler: DatadogFlushHandler = flushDatadogLogs

export function isDatadogLogsEnabled(env: Record<string, unknown>): boolean {
  const flag = String(env.DD_LOGS_ENABLED ?? '').trim().toLowerCase()
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') return false
  return Boolean(String(env.DD_API_KEY ?? '').trim())
}

export function normalizeDatadogSite(site: string): string {
  const trimmed = site.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (!trimmed) return 'datadoghq.eu'
  if (trimmed.includes('.')) return trimmed
  return `${trimmed}.datadoghq.eu`
}

export function buildDatadogIntakeUrl(env: Record<string, unknown>): string {
  const configured = String(env.DD_SITE ?? 'datadoghq.eu').trim() || 'datadoghq.eu'
  if (configured.startsWith('http')) {
    const base = configured.replace(/\/$/, '')
    return base.includes('/api/v2/logs') ? base : `${base}/api/v2/logs`
  }
  const site = normalizeDatadogSite(configured)
  return `https://http-intake.logs.${site}/api/v2/logs`
}

/** Human-readable summary for Datadog list view (message column). */
export function formatLogMessage(entry: LogEntry): string {
  const parts: string[] = []
  if (entry.http_method && entry.http_path) {
    parts.push(`${entry.http_method} ${entry.http_path}`)
    if (entry.http_status != null) parts.push(`→ ${entry.http_status}`)
  }
  parts.push(entry.event)
  if (entry.error_message) {
    parts.push(String(entry.error_message))
  } else if (entry.duration_ms != null) {
    parts.push(`${entry.duration_ms}ms`)
  }
  const summary = parts.join(' ')
  const component = String(entry.service ?? '').trim()
  return component ? `${component}: ${summary}` : summary
}

export function resolveDatadogVersion(env: Record<string, unknown>): string {
  const explicit = String(env.DD_VERSION ?? '').trim()
  if (explicit) return explicit
  const meta = env.CF_VERSION_METADATA as { id?: string } | undefined
  return String(meta?.id ?? '').trim()
}

export function buildDatadogTags(env: Record<string, unknown>): string | undefined {
  const tags: string[] = []
  const ddEnv = String(env.DD_ENV ?? '').trim()
  if (ddEnv) tags.push(`env:${ddEnv}`)
  const version = resolveDatadogVersion(env)
  if (version) tags.push(`version:${version}`)
  return tags.length > 0 ? tags.join(',') : undefined
}

/** Structured fields as Datadog attributes (entry.service → component to avoid clashing with DD service). */
export function buildDatadogAttributes(entry: LogEntry): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined) continue
    if (key === 'service') {
      attrs.component = value
      continue
    }
    attrs[key] = value
  }
  return attrs
}

export function buildDatadogLogBatch(entries: LogEntry[], env: Record<string, unknown>) {
  const service = String(env.DD_SERVICE ?? 'vmp-api').trim() || 'vmp-api'
  const ddtags = buildDatadogTags(env)

  return entries.map((entry) => {
    const level = entry.level ?? 'info'
    const status = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
    return {
      message: formatLogMessage(entry),
      ddsource: 'cloudflare-worker',
      service,
      hostname: 'cloudflare',
      status,
      ...(ddtags ? { ddtags } : {}),
      ...buildDatadogAttributes(entry),
    }
  })
}

export async function flushDatadogLogs(env: Record<string, unknown>, entries: LogEntry[]): Promise<void> {
  const apiKey = String(env.DD_API_KEY ?? '').trim()
  if (!apiKey || entries.length === 0) return

  const response = await fetch(buildDatadogIntakeUrl(env), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': apiKey,
    },
    body: JSON.stringify(buildDatadogLogBatch(entries, env)),
  })

  if (response.status !== 202 && !response.ok) {
    console.error(`[datadog] log upload failed: HTTP ${response.status}`)
  }
}

/** @internal Test hook — pass null to restore the default HTTP flush handler. */
export function setDatadogFlushHandlerForTests(handler: DatadogFlushHandler | null): void {
  datadogFlushHandler = handler ?? flushDatadogLogs
}

/**
 * Flushes the buffered logs to Datadog.
 *
 * LIMITATION: Only logs emitted during the main handler execution (before `fn`
 * resolves in `runWithDatadogLogContext`) are flushed. Logs from background work
 * scheduled via `ctx.waitUntil` AFTER the handler returns are NOT captured.
 *
 * If you need to log from post-response background tasks, explicitly call
 * `scheduleDatadogFlush` before those tasks complete, or emit logs before the
 * main handler returns.
 */
function scheduleDatadogFlush(context: DatadogLogContext): void {
  if (context.buffer.length === 0 || !isDatadogLogsEnabled(context.env)) return

  const batch = context.buffer.splice(0, context.buffer.length)
  context.ctx.waitUntil(
    datadogFlushHandler(context.env, batch).catch((err) => {
      console.error('[datadog] log upload error:', err)
    }),
  )
}

/** Run a Worker handler with isolated Datadog log buffering for this invocation. */
export async function runWithDatadogLogContext<T>(
  env: Record<string, unknown>,
  ctx: ExecutionContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  const ddContext: DatadogLogContext = { env, ctx, buffer: [] }
  try {
    return await datadogLogContextStorage.run(ddContext, fn)
  } finally {
    scheduleDatadogFlush(ddContext)
  }
}

export function log(fields: LogFields): void {
  const entry: LogEntry = {
    level: 'info',
    ...fields,
    ts: new Date().toISOString(),
  }
  if (entry.level === undefined) entry.level = 'info'

  console.log(JSON.stringify(entry))

  const ddContext = datadogLogContextStorage.getStore()
  if (ddContext && isDatadogLogsEnabled(ddContext.env)) {
    ddContext.buffer.push(entry)
  }
}

/** Convenience: hash any string to a short hex prefix safe for logs */
export async function hashForLog(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
