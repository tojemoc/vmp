/**
 * CORS helpers — mirrors buildCorsHeaders / parseAllowedOrigins in packages/api/src/index.ts
 */

export function parseAllowedOrigins(envValue: string | undefined): string[] {
  if (!envValue) return []
  return envValue.split(',').map((o) => o.trim()).filter(Boolean)
}

export function buildCorsHeaders(request: Request, env: { ALLOWED_ORIGINS?: string }): Record<string, string> {
  const requestOrigin = request.headers.get('Origin') || ''
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS)

  if (allowedOrigins.includes(requestOrigin)) {
    return {
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers':
        'Accept-Ranges, Content-Length, Content-Range, Content-Type, x-d1-bookmark',
      Vary: 'Origin',
    }
  }

  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers':
      'Accept-Ranges, Content-Length, Content-Range, Content-Type, x-d1-bookmark',
  }
}
