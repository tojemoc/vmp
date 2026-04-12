import {
  TUS_VERSION,
  TUS_UPLOAD_ALLOW_METHODS,
  parseUploadMetadata,
  sanitizeFileName,
  sanitizeVisibility,
  tusResponse,
  json,
  jsonString,
} from './uploads/_utils.js'

export async function onRequest(context: any) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return tusResponse(null, 204, {}, request, TUS_UPLOAD_ALLOW_METHODS)
  }

  if (!env.VIDEO_BUCKET) {
    return json({ error: 'VIDEO_BUCKET binding is required' }, 500, request, TUS_UPLOAD_ALLOW_METHODS)
  }

  if (request.method !== 'POST') {
    return tusResponse(null, 405, { Allow: 'POST,OPTIONS' }, request, TUS_UPLOAD_ALLOW_METHODS)
  }

  const tusVersion = request.headers.get('Tus-Resumable')
  if (tusVersion !== TUS_VERSION) {
    return tusResponse(jsonString({ error: 'Missing or invalid Tus-Resumable header' }), 412, {}, request, TUS_UPLOAD_ALLOW_METHODS)
  }

  const uploadLength = Number(request.headers.get('Upload-Length'))
  if (!Number.isFinite(uploadLength) || uploadLength <= 0) {
    return tusResponse(jsonString({ error: 'Upload-Length header is required and must be > 0' }), 400, {}, request, TUS_UPLOAD_ALLOW_METHODS)
  }

  const metadata = parseUploadMetadata(request.headers.get('Upload-Metadata'))
  const fileName = sanitizeFileName(metadata.filename || 'upload.bin')
  const contentType = (metadata.filetype || 'application/octet-stream').toLowerCase()
  if (!contentType.startsWith('video/')) {
    return tusResponse(jsonString({ error: 'Only video uploads are allowed' }), 400, {}, request, TUS_UPLOAD_ALLOW_METHODS)
  }

  const visibility = sanitizeVisibility(metadata.visibility)
  const videoId = crypto.randomUUID()
  const sourceKey = `videos/${videoId}/source/${fileName}`
  const sessionKey = `videos/${videoId}/upload-session.json`

  const multipartUpload = await env.VIDEO_BUCKET.createMultipartUpload(sourceKey, {
    httpMetadata: { contentType },
    customMetadata: {
      status: 'uploading',
      visibility,
      uploadedAt: new Date().toISOString(),
    },
  })

  const session = {
    videoId,
    sourceKey,
    uploadId: multipartUpload.uploadId,
    uploadLength,
    offset: 0,
    partNumber: 1,
    parts: [],
    visibility,
    fileName,
    contentType,
    createdAt: new Date().toISOString(),
  }

  await env.VIDEO_BUCKET.put(sessionKey, JSON.stringify(session), {
    httpMetadata: { contentType: 'application/json' },
  })

  return tusResponse(null, 201, {
    Location: `/api/uploads/${videoId}`,
    'Upload-Offset': '0',
    'Upload-Length': String(uploadLength),
  }, request, TUS_UPLOAD_ALLOW_METHODS)
}
