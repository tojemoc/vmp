import type { ErrorEvent, Log } from '@sentry/core'

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'x-smoke-token',
])

export function parseTracesSampleRate(value: unknown, defaultRate = 0.1): number {
  if (typeof value !== 'string' || !value.trim()) return defaultRate
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return defaultRate
  return Math.min(1, Math.max(0, parsed))
}

export function parseEnvBoolean(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export type SentryPublicConfig = {
  dsn: string
  tracesSampleRate: number
  environment: string
  enableLogs: boolean
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...record }
  for (const key of Object.keys(redacted)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[Redacted]'
    }
  }
  return redacted
}

export function buildSentryInitOptions(config: SentryPublicConfig) {
  if (!config.dsn) return null

  const options: {
    dsn: string
    tracesSampleRate: number
    environment?: string
    enableLogs: boolean
    beforeSend?: (event: ErrorEvent) => ErrorEvent | null
    beforeSendLog?: (log: Log) => Log | null
  } = {
    dsn: config.dsn,
    tracesSampleRate: config.tracesSampleRate,
    enableLogs: config.enableLogs,
  }

  if (config.environment) {
    options.environment = config.environment
  }

  if (config.enableLogs) {
    options.beforeSend = (event) => {
      if (event.request?.headers) {
        event.request.headers = redactRecord(event.request.headers as Record<string, unknown>) as Record<string, string>
      }
      return event
    }
    options.beforeSendLog = (log) => {
      if (log.attributes) {
        log.attributes = redactRecord(log.attributes as Record<string, unknown>) as Log['attributes']
      }
      return log
    }
  }

  return options
}
