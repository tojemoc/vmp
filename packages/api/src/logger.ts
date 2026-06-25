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
 *   DD_SERVICE=vmp-api           — optional
 *   DD_ENV=staging               — optional tag (env:staging)
 *
 * Wrap each Worker entry point (fetch / scheduled / queue) in
 * `runWithDatadogLogContext(env, ctx, fn)` so batched uploads use `ctx.waitUntil`.
 *
 * In Datadog Logs Explorer, search: `source:cloudflare-worker service:vmp-api`
 * Pipeline Grok (optional): `json_rule %{data::json}` on the `message` field.
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

export function buildDatadogLogBatch(entries: LogEntry[], env: Record<string, unknown>) {
  const service = String(env.DD_SERVICE ?? 'vmp-api').trim() || 'vmp-api'
  const ddEnv = String(env.DD_ENV ?? '').trim()
  const ddtags = ddEnv ? `env:${ddEnv}` : undefined

  return entries.map((entry) => {
    const level = entry.level ?? 'info'
    const status = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
    return {
      message: JSON.stringify(entry),
      ddsource: 'cloudflare-worker',
      service,
      hostname: 'cloudflare',
      status,
      ...(ddtags ? { ddtags } : {}),
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
