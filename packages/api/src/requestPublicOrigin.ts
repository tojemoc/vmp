/**
 * Resolve the public origin clients should use for API URLs (video-proxy, RSS, etc.).
 *
 * Behind TLS-terminating proxies (Deno, Vercel, nginx), `request.url` may still be
 * `http://` if the adapter did not honor X-Forwarded-Proto. Prefer explicit
 * `API_PUBLIC_URL` / `API_URL`, then forwarded headers, then request.url.
 * Public (non-local) hosts are always upgraded to HTTPS to prevent mixed-content
 * playback when TLS terminates in front of api-node.
 */

export type PublicOriginEnv = {
  API_PUBLIC_URL?: string
  /** Deno / ops often set API_URL; treat as alias for API_PUBLIC_URL on api-node. */
  API_URL?: string
}

function firstHeaderValue(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.split(',')[0]?.trim()
  return trimmed || null
}

function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '[::1]'
    || host.endsWith('.local')
  )
}

function originFromConfiguredUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return u.origin
  } catch {
    return null
  }
}

/** Explicit public API origin from env (API_PUBLIC_URL, then API_URL). */
export function resolveExplicitPublicOrigin(env?: PublicOriginEnv): string | null {
  for (const key of ['API_PUBLIC_URL', 'API_URL'] as const) {
    const raw = typeof env?.[key] === 'string' ? env[key] : ''
    const origin = originFromConfiguredUrl(raw)
    if (origin) return normalizePublicOrigin(origin)
  }
  return null
}

/** Upgrade http→https for public hosts; keeps localhost/http dev unchanged. */
export function normalizePublicOrigin(origin: string): string {
  try {
    const u = new URL(origin)
    if (u.protocol === 'https:') return u.origin
    if (isLocalDevHost(u.hostname)) return u.origin
    u.protocol = 'https:'
    return u.origin
  } catch {
    return origin
  }
}

/** Like normalizePublicOrigin but preserves path and query on full request URLs. */
export function normalizePublicUrl(urlString: string): string {
  try {
    const u = new URL(urlString)
    if (u.protocol === 'https:') return u.toString()
    if (isLocalDevHost(u.hostname)) return u.toString()
    u.protocol = 'https:'
    return u.toString()
  } catch {
    return urlString
  }
}

/** Headers from a Fetch API Request or Node IncomingMessage. */
type HeaderSource = {
  get(name: string): string | null
}

function headerSourceFromNodeHeaders(headers: Record<string, string | string[] | undefined>): HeaderSource {
  return {
    get(name: string) {
      const key = name.toLowerCase()
      const raw = headers[key] ?? headers[name]
      if (raw === undefined) return null
      if (Array.isArray(raw)) return raw[0] ?? null
      return raw
    },
  }
}

export function getRequestPublicOriginFromHeaders(
  headers: HeaderSource,
  fallbackOrigin: string,
  env?: PublicOriginEnv,
): string {
  const explicit = resolveExplicitPublicOrigin(env)
  if (explicit) return explicit

  const forwardedProto = firstHeaderValue(headers.get('x-forwarded-proto'))
  const forwardedHost = firstHeaderValue(headers.get('x-forwarded-host'))
  const host = forwardedHost || firstHeaderValue(headers.get('host'))

  if (host) {
    const proto = forwardedProto || 'https'
    return normalizePublicOrigin(`${proto}://${host}`)
  }

  return normalizePublicOrigin(fallbackOrigin)
}

export function getRequestPublicOrigin(request: Request, env?: PublicOriginEnv): string {
  const fallback = new URL(request.url).origin
  return getRequestPublicOriginFromHeaders(request.headers, fallback, env)
}

/**
 * Build the absolute URL for a Node HTTP incoming request (Deno api-node).
 */
export function buildNodeIncomingRequestUrl(
  req: { headers: Record<string, string | string[] | undefined>; url?: string | null },
  options?: { defaultPort?: number; env?: PublicOriginEnv },
): string {
  const path = req.url ?? '/'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  const explicit = resolveExplicitPublicOrigin(options?.env)
  if (explicit) {
    return `${explicit}${normalizedPath}`
  }

  const port = options?.defaultPort ?? 8787
  const headers = headerSourceFromNodeHeaders(req.headers)
  const host =
    firstHeaderValue(headers.get('x-forwarded-host'))
    || firstHeaderValue(headers.get('host'))
    || `localhost:${port}`

  let proto = firstHeaderValue(headers.get('x-forwarded-proto'))
  if (!proto) proto = 'http'

  return normalizePublicUrl(`${proto}://${host}${normalizedPath}`)
}

/** True when url points at this host's /api/video-proxy (any resolved public/internal origin). */
export function isLocalVideoProxyUrl(request: Request, urlString: string, env?: PublicOriginEnv): boolean {
  if (typeof urlString !== 'string' || !urlString) return false
  let pathname: string
  let origin: string
  try {
    const u = new URL(urlString)
    pathname = u.pathname
    origin = u.origin
  } catch {
    return false
  }
  if (!pathname.startsWith('/api/video-proxy')) return false

  const publicOrigin = getRequestPublicOrigin(request, env)
  const requestOrigin = normalizePublicOrigin(new URL(request.url).origin)
  const normalizedUrlOrigin = normalizePublicOrigin(origin)
  return normalizedUrlOrigin === publicOrigin
    || normalizedUrlOrigin === requestOrigin
    || origin === publicOrigin
    || origin === new URL(request.url).origin
}
