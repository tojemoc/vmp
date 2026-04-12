export const TUS_VERSION = '1.0.0'
export const TUS_UPLOAD_ALLOW_METHODS = 'POST,OPTIONS'
export const TUS_CHUNK_ALLOW_METHODS = 'HEAD,PATCH,OPTIONS'

export interface UploadSessionPart {
  partNumber: number
  etag: string
  size: number
}

export interface UploadSession {
  videoId: string
  sourceKey: string
  uploadId: string
  uploadLength: number
  offset: number
  partNumber: number
  parts: UploadSessionPart[]
  visibility: 'public' | 'unlisted' | 'private'
  fileName: string
  contentType: string
  createdAt: string
}

export function parseUploadMetadata(headerValue: string | undefined): Record<string, string> {
  if (!headerValue) return {}
  const result: Record<string, string> = {}
  const entries = headerValue.split(',')

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const [rawKey, rawValue] = trimmed.split(' ')
    if (!rawKey || !rawValue) continue

    try {
      result[rawKey] = atob(rawValue)
    } catch {
      continue
    }
  }

  return result
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

export function sanitizeVisibility(value: string | undefined): 'public' | 'unlisted' | 'private' {
  return value === 'public' || value === 'unlisted' ? value : 'private'
}

export function withCors(response: Response, request: Request, allowMethods: string): Response {
  const headers = new Headers(response.headers)
  const origin = request.headers.get('Origin')
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set('Vary', 'Origin')
  } else {
    headers.set('Access-Control-Allow-Origin', '*')
  }
  headers.set('Access-Control-Allow-Methods', allowMethods)
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Tus-Resumable, Upload-Length, Upload-Offset, Upload-Metadata')
  headers.set('Access-Control-Expose-Headers', 'Tus-Resumable, Upload-Offset, Upload-Length, Location, Upload-Complete, Upload-Result')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function tusResponse(
  body: BodyInit | null,
  status = 200,
  extraHeaders: Record<string, string> = {},
  request: Request,
  allowMethods: string,
): Response {
  return withCors(new Response(body, {
    status,
    headers: {
      'Tus-Resumable': TUS_VERSION,
      ...extraHeaders,
    },
  }), request, allowMethods)
}

export function json(data: unknown, status = 200, request: Request, allowMethods: string): Response {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  }), request, allowMethods)
}

export function jsonString(data: unknown): string {
  return JSON.stringify(data)
}
