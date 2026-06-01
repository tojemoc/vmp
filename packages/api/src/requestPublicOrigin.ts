/**
 * Resolve the public origin clients should use for API URLs (video-proxy, RSS, etc.).
 *
 * Behind TLS-terminating proxies (Deno, Vercel, nginx), `request.url` may still be
 * `http://` if the adapter did not honor X-Forwarded-Proto. Prefer explicit
 * `API_PUBLIC_URL`, then forwarded headers, then request.url.
 */

function firstHeaderValue(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.split(',')[0]?.trim()
  return trimmed || null
}

function originFromApiPublicUrl(env?: { API_PUBLIC_URL?: string }): string | null {
  const raw = typeof env?.API_PUBLIC_URL === 'string' ? env.API_PUBLIC_URL.trim() : ''
  if (!raw) return null
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return u.origin
  } catch {
    return null
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
  env?: { API_PUBLIC_URL?: string },
): string {
  const explicit = originFromApiPublicUrl(env)
  if (explicit) return explicit

  const forwardedProto = firstHeaderValue(headers.get('x-forwarded-proto'))
  const forwardedHost = firstHeaderValue(headers.get('x-forwarded-host'))
  const host = forwardedHost || firstHeaderValue(headers.get('host'))

  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`
  }

  return fallbackOrigin
}

export function getRequestPublicOrigin(request: Request, env?: { API_PUBLIC_URL?: string }): string {
  const fallback = new URL(request.url).origin
  return getRequestPublicOriginFromHeaders(request.headers, fallback, env)
}

/**
 * Build the absolute URL for a Node HTTP incoming request (Deno api-node).
 */
export function buildNodeIncomingRequestUrl(
  req: { headers: Record<string, string | string[] | undefined>; url?: string | null },
  options?: { defaultPort?: number; env?: { API_PUBLIC_URL?: string } },
): string {
  const port = options?.defaultPort ?? 8787
  const headers = headerSourceFromNodeHeaders(req.headers)
  const host =
    firstHeaderValue(headers.get('x-forwarded-host')) ||
    firstHeaderValue(headers.get('host')) ||
    `localhost:${port}`

  let proto = firstHeaderValue(headers.get('x-forwarded-proto'))
  if (!proto && options?.env?.API_PUBLIC_URL) {
    try {
      proto = new URL(
        options.env.API_PUBLIC_URL.includes('://')
          ? options.env.API_PUBLIC_URL
          : `https://${options.env.API_PUBLIC_URL}`,
      ).protocol.replace(':', '')
    } catch {
      /* ignore */
    }
  }
  if (!proto) proto = 'http'

  const path = req.url ?? '/'
  return `${proto}://${host}${path}`
}

/** True when url points at this host's /api/video-proxy (any resolved public/internal origin). */
export function isLocalVideoProxyUrl(request: Request, urlString: string, env?: { API_PUBLIC_URL?: string }): boolean {
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
  const requestOrigin = new URL(request.url).origin
  return origin === publicOrigin || origin === requestOrigin
}
