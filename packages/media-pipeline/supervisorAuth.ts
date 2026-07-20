import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Paths that accept HMAC-signed webhook bodies (VMP_WEBHOOK_SECRET). */
export const REBUILD_WEBHOOK_PATHS = new Set([
  '/api/podcast-preview-rebuild',
  '/vmp/api/podcast-preview-rebuild',
  '/vmp/podcast-preview-rebuild',
])

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === '127.0.0.1' || h === '::1' || h === 'localhost'
}

export function isWebhookPath(pathname: string, method: string): boolean {
  return method === 'POST' && REBUILD_WEBHOOK_PATHS.has(pathname)
}

export function isPackagingApiPath(pathname: string, method: string): boolean {
  if (method === 'POST' && pathname === '/api/packaging/enqueue') return true
  if (method === 'GET' && /^\/api\/packaging\/status\/[^/]+$/.test(pathname)) return true
  return false
}

export function isPackagerCallbackPath(pathname: string, method: string): boolean {
  return method === 'POST' && /^\/vmp\/api\/packagerCallback\/(success|failure)$/.test(pathname)
}

/** Routes that use their own secrets (webhooks, packaging, packager callbacks). */
export function isExternallyAuthenticatedPath(pathname: string, method: string): boolean {
  return isWebhookPath(pathname, method)
    || isPackagingApiPath(pathname, method)
    || isPackagerCallbackPath(pathname, method)
}

/**
 * Dashboard HTML, status API, and job control require VMP_SUPERVISOR_DASHBOARD_SECRET
 * when configured (mandatory on non-loopback bind addresses).
 */
export function requiresDashboardAuth(pathname: string, method: string): boolean {
  if (pathname === '/' && method === 'GET') return false
  if (pathname === '/health' && method === 'GET') return false
  if (isExternallyAuthenticatedPath(pathname, method)) return false
  return true
}

export function isDashboardAuthConfigured(dashboardSecret: string): boolean {
  return Boolean(dashboardSecret.trim())
}

export function extractSupervisorToken(req: IncomingMessage): string {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }
  const header = req.headers['x-vmp-supervisor-token']
  const raw = Array.isArray(header) ? header[0] : header
  return typeof raw === 'string' ? raw.trim() : ''
}

export function timingSafeEqualString(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function verifyDashboardSecret(req: IncomingMessage, dashboardSecret: string): boolean {
  if (!dashboardSecret) return true
  const provided = extractSupervisorToken(req)
  if (!provided) return false
  return timingSafeEqualString(provided, dashboardSecret)
}

/**
 * Eyevinn encore-packager only supports Basic auth via CALLBACK_URL
 * (`http://user:password@host/path`). We also accept `x-vmp-pipeline-secret`
 * for manual/testing clients.
 */
export function verifyPackagerCallbackSecret(req: IncomingMessage, packagerSecret: string): boolean {
  if (!packagerSecret) return true

  const header = req.headers['x-vmp-pipeline-secret']
  const fromHeader = Array.isArray(header) ? header[0] : header
  if (typeof fromHeader === 'string' && fromHeader.length > 0) {
    return timingSafeEqualString(fromHeader, packagerSecret)
  }

  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice('Basic '.length).trim(), 'base64').toString('utf8')
      const colon = decoded.indexOf(':')
      const password = colon >= 0 ? decoded.slice(colon + 1) : decoded
      return timingSafeEqualString(password, packagerSecret)
    } catch {
      return false
    }
  }

  return false
}

/**
 * Success callbacks include `jobId`. Failure callbacks from Eyevinn only send
 * `{ message }` where `message` is the raw Redis queue JSON (`{ jobId, url }`).
 */
export function resolvePackagerCallbackJobId(payload: {
  jobId?: unknown
  message?: unknown
}): string {
  const direct = String(payload.jobId || '').trim()
  if (direct) return direct

  const raw = String(payload.message || '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as { jobId?: unknown }
    return String(parsed.jobId || '').trim()
  } catch {
    return ''
  }
}
