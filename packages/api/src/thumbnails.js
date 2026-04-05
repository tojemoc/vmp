/**
 * packages/api/src/thumbnails.js
 *
 * Thumbnail upload and delete handlers for Step 7.
 *
 * R2 storage layout (same bucket as video assets, separate prefix):
 *   thumbnails/{videoId}/original.jpg   — source file as uploaded (kept for re-processing)
 *   thumbnails/{videoId}/large.jpg      — 1280×720, quality 85
 *   thumbnails/{videoId}/medium.jpg     —  640×360, quality 82
 *   thumbnails/{videoId}/small.jpg      —  320×180, quality 80
 *
 * D1: videos.thumbnail_url is updated to point at the large.jpg variant,
 * e.g. https://<R2_BASE_URL>/thumbnails/{videoId}/large.jpg.
 *
 * Image resizing uses OffscreenCanvas + createImageBitmap, both available in
 * Cloudflare Workers' Chromium runtime.  If either API is absent the upload
 * still succeeds — all four size keys are stored as the original file and a
 * warning is logged.  This is a known limitation noted below.
 */

import { requireRole } from './auth.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const SIZES = [
  { key: 'large',  width: 1280, height: 720, quality: 85 },
  { key: 'medium', width:  640, height: 360, quality: 82 },
  { key: 'small',  width:  320, height: 180, quality: 80 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function getDb(env) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('Database binding not configured')
  return db
}

/**
 * Resize an image buffer to targetWidth × targetHeight at the given JPEG quality.
 *
 * Known limitation: createImageBitmap / OffscreenCanvas may not be available in
 * all Cloudflare Worker runtime versions.  The caller should catch errors from
 * this function and fall back to storing the original bytes unchanged.
 *
 * @param {ArrayBuffer} sourceBuffer
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @param {number} quality  — integer 0–100; divided by 100 for the Canvas API
 * @returns {Promise<Blob>}
 */
async function resizeImage(sourceBuffer, targetWidth, targetHeight, quality) {
  const blob   = new Blob([sourceBuffer], { type: 'image/jpeg' })
  const bitmap = await createImageBitmap(blob, {
    resizeWidth:   targetWidth,
    resizeHeight:  targetHeight,
    resizeQuality: 'high',
  })
  const canvas = new OffscreenCanvas(targetWidth, targetHeight)
  const ctx    = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 })
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/videos/:id/thumbnail
 *
 * Accepts multipart/form-data with a single field "thumbnail" (JPEG or PNG,
 * max 10 MB).  Resizes to four variants, uploads all to R2, and updates D1.
 *
 * Returns:
 *   { ok: true, thumbnails: { original, large, medium, small } }
 */
export async function handleThumbnailUpload(request, env, corsHeaders) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders)
  }

  const url   = new URL(request.url)
  const match = url.pathname.match(/^\/api\/admin\/videos\/([^/]+)\/thumbnail$/)
  if (!match) return jsonResponse({ error: 'Not Found' }, 404, corsHeaders)
  const videoId = decodeURIComponent(match[1])

  // Reject obviously-oversized requests before reading the body.
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_BYTES) {
    return jsonResponse({ error: 'File too large. Maximum size is 10 MB.' }, 413, corsHeaders)
  }

  let formData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Invalid multipart form data.' }, 400, corsHeaders)
  }

  const file = formData.get('thumbnail')
  if (!file || typeof file === 'string') {
    return jsonResponse({ error: 'Missing "thumbnail" field in form data.' }, 400, corsHeaders)
  }

  // Only JPEG and PNG are accepted.
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return jsonResponse(
      { error: `Unsupported file type "${file.type}". Only image/jpeg and image/png are accepted.` },
      415,
      corsHeaders,
    )
  }

  // Secondary size guard (Content-Length header may be absent or spoofed).
  const sourceBuffer = await file.arrayBuffer()
  if (sourceBuffer.byteLength > MAX_BYTES) {
    return jsonResponse({ error: 'File too large. Maximum size is 10 MB.' }, 413, corsHeaders)
  }

  const db        = getDb(env)
  const r2BaseUrl = (env.R2_BASE_URL || '').replace(/\/$/, '')

  // Store the original.
  await env.BUCKET.put(
    `thumbnails/${videoId}/original.jpg`,
    sourceBuffer,
    { httpMetadata: { contentType: 'image/jpeg' } },
  )
  const thumbUrls = {
    original: `${r2BaseUrl}/thumbnails/${videoId}/original.jpg`,
  }

  // Resize to each size variant.  If resizing is unavailable, fall back to
  // storing the original bytes for all variants — the upload still succeeds.
  let resizingSupported = true
  for (const { key, width, height, quality } of SIZES) {
    let blob
    try {
      blob = await resizeImage(sourceBuffer, width, height, quality)
    } catch (err) {
      // Known limitation: OffscreenCanvas / createImageBitmap not available in
      // this Worker runtime.  All size variants will be stored as the original.
      console.warn(
        `[thumbnails] resizeImage failed (${err?.message}). ` +
        'Storing original bytes for all size variants.',
      )
      resizingSupported = false
      blob = new Blob([sourceBuffer], { type: 'image/jpeg' })
    }

    await env.BUCKET.put(
      `thumbnails/${videoId}/${key}.jpg`,
      await blob.arrayBuffer(),
      { httpMetadata: { contentType: 'image/jpeg' } },
    )
    thumbUrls[key] = `${r2BaseUrl}/thumbnails/${videoId}/${key}.jpg`
  }

  if (!resizingSupported) {
    console.warn('[thumbnails] All variants stored as original — image resizing unavailable in this runtime.')
  }

  // Update D1 to point at the large variant.
  await db
    .prepare('UPDATE videos SET thumbnail_url = ? WHERE id = ?')
    .bind(thumbUrls.large, videoId)
    .run()

  return jsonResponse({ ok: true, thumbnails: thumbUrls }, 200, corsHeaders)
}

/**
 * DELETE /api/admin/videos/:id/thumbnail
 *
 * Removes all four R2 keys for the video's thumbnails and clears
 * videos.thumbnail_url in D1.
 *
 * Returns: { ok: true }
 */
export async function handleThumbnailDelete(request, env, corsHeaders) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders)
  }

  const url   = new URL(request.url)
  const match = url.pathname.match(/^\/api\/admin\/videos\/([^/]+)\/thumbnail$/)
  if (!match) return jsonResponse({ error: 'Not Found' }, 404, corsHeaders)
  const videoId = decodeURIComponent(match[1])

  const db = getDb(env)

  // Delete all four R2 keys in parallel.
  await Promise.all([
    env.BUCKET.delete(`thumbnails/${videoId}/original.jpg`),
    env.BUCKET.delete(`thumbnails/${videoId}/large.jpg`),
    env.BUCKET.delete(`thumbnails/${videoId}/medium.jpg`),
    env.BUCKET.delete(`thumbnails/${videoId}/small.jpg`),
  ])

  // Clear thumbnail_url in D1.
  await db
    .prepare('UPDATE videos SET thumbnail_url = NULL WHERE id = ?')
    .bind(videoId)
    .run()

  return jsonResponse({ ok: true }, 200, corsHeaders)
}
