/**
 * packages/api/src/bunnyStream.ts
 *
 * Bunny.net Stream transcoding integration.
 *
 * Upload flow (browser-direct via TUS, Worker never proxies video bytes):
 *   1. POST create video object → receive guid
 *   2. Browser TUS upload to tusupload with presigned AuthorizationSignature (no API key in client)
 *   3. POST /complete → mark job queued; Bunny transcodes automatically
 *   4. Cron pollBunny jobs until status=finished → store HLS manifest URL in D1
 *
 * Bunny API quirks:
 *   - Auth is header `AccessKey`, not Bearer
 *   - Upload is a single raw-body PUT, not multipart/form-data
 *   - Status is numeric (0–5), not string enums
 *   - HLS lives on Bunny CDN (pull zone), not in our R2 — preview truncation via
 *     /api/video-proxy manifest rewriting does NOT apply (see mediaEntrypoints TODO)
 */

import { requireRole } from './auth.js'
import { ensureAdminSettingsTable } from './adminSettingsTable.js'
import { getSettings, setSettings } from './settingsStore.js'

type CorsHeaders = Record<string, string>

/** Bunny numeric status codes from GET /videos/{guid} */
const BUNNY_STATUS_QUEUED = 0
const BUNNY_STATUS_PROCESSING = 1
const BUNNY_STATUS_TRANSCODING = 2
const BUNNY_STATUS_FINISHED = 3
const BUNNY_STATUS_ERROR = 4
const BUNNY_STATUS_UPLOAD_FAILED = 5

export type BunnyVideoStatusName =
  | 'queued'
  | 'processing'
  | 'transcoding'
  | 'finished'
  | 'error'

export type BunnyVideoStatus = {
  status: BunnyVideoStatusName
  playbackUrl?: string
  hlsManifestUrl?: string
  durationSeconds?: number
  thumbnailUrl?: string
  rawStatus: number
}

type WorkerEnv = {
  DB?: D1Database
  video_subscription_db?: D1Database
  BUNNYNET_STREAM_ENABLED?: string
  BUNNYNET_STREAM_LIBRARY_ID?: string
  BUNNYNET_STREAM_API_KEY?: string
  BUNNYNET_STREAM_PULL_ZONE?: string
  BUNNYNET_STREAM_CDN_HOSTNAME?: string
}

type BunnyStreamConfig = {
  enabled: boolean
  libraryId: string
  apiKey: string
  pullZone: string
  cdnHostname: string
  configured: boolean
}

const BUNNY_API_BASE = 'https://video.bunnycdn.com/library'

function jsonResponse(data: unknown, status = 200, corsHeaders: CorsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function getDb(env: WorkerEnv) {
  return env.DB || env.video_subscription_db
}

function envTrim(env: WorkerEnv, key: string, fallback = ''): string {
  const v = env?.[key as keyof WorkerEnv]
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

/** Read Bunny Stream settings from admin_settings with wrangler var fallbacks. */
export async function getBunnyStreamConfig(env: WorkerEnv): Promise<BunnyStreamConfig> {
  const db = getDb(env)
  if (!db) {
    return {
      enabled: false,
      libraryId: '',
      apiKey: '',
      pullZone: '',
      cdnHostname: '',
      configured: false,
    }
  }
  await ensureAdminSettingsTable(db)
  const settings = await getSettings(env, [
    'bunnynet_stream_enabled',
    'bunnynet_stream_library_id',
    'bunnynet_stream_api_key',
    'bunnynet_stream_pull_zone',
    'bunnynet_stream_cdn_hostname',
  ])
  const read = (key: string, envKey: string, fallback = '') => {
    const fromSettings = String(settings[key] ?? '').trim()
    if (fromSettings) return fromSettings
    return envTrim(env, envKey, fallback)
  }
  const libraryId = read('bunnynet_stream_library_id', 'BUNNYNET_STREAM_LIBRARY_ID')
  const apiKey = read('bunnynet_stream_api_key', 'BUNNYNET_STREAM_API_KEY')
  const pullZone = read('bunnynet_stream_pull_zone', 'BUNNYNET_STREAM_PULL_ZONE')
  const cdnHostname = read('bunnynet_stream_cdn_hostname', 'BUNNYNET_STREAM_CDN_HOSTNAME')
  const enabled = read('bunnynet_stream_enabled', 'BUNNYNET_STREAM_ENABLED', '0') === '1'
  const configured = Boolean(libraryId && apiKey && (cdnHostname || pullZone))
  return { enabled, libraryId, apiKey, pullZone, cdnHostname, configured }
}

function bunnyLibraryUrl(libraryId: string, path = ''): string {
  const base = `${BUNNY_API_BASE}/${encodeURIComponent(libraryId)}`
  return path ? `${base}/${path.replace(/^\//, '')}` : base
}

function mapBunnyNumericStatus(code: number): BunnyVideoStatusName {
  if (code === BUNNY_STATUS_FINISHED) return 'finished'
  if (code === BUNNY_STATUS_ERROR || code === BUNNY_STATUS_UPLOAD_FAILED) return 'error'
  if (code === BUNNY_STATUS_TRANSCODING) return 'transcoding'
  if (code === BUNNY_STATUS_PROCESSING) return 'processing'
  return 'queued'
}

function bunnyCdnHost(cfg: BunnyStreamConfig): string {
  return cfg.cdnHostname.trim()
    || (cfg.pullZone.trim() ? `${cfg.pullZone.trim()}.b-cdn.net` : '')
}

/** Build direct HLS manifest URL on Bunny's CDN (not iframe player). */
export function buildBunnyHlsManifestUrl(cfg: BunnyStreamConfig, videoGuid: string): string {
  const host = bunnyCdnHost(cfg)
  if (!host) return ''
  const normalizedHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${normalizedHost}/${encodeURIComponent(videoGuid)}/playlist.m3u8`
}

/** Resolve thumbnail to a public CDN URL when Bunny returns only a filename. */
export function buildBunnyThumbnailUrl(cfg: BunnyStreamConfig, videoGuid: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.includes('://') || trimmed.startsWith('//')) return trimmed
  const host = bunnyCdnHost(cfg)
  if (!host) return trimmed
  const normalizedHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const file = trimmed.replace(/^\//, '')
  return `https://${normalizedHost}/${encodeURIComponent(videoGuid)}/${file}`
}

const BUNNY_TUS_UPLOAD_ENDPOINT = 'https://video.bunnycdn.com/tusupload'
/** Bunny requires expire at least ~1h ahead; default 2h for large uploads. */
const BUNNY_TUS_UPLOAD_TTL_SECONDS = 2 * 60 * 60

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * TUS presigned upload credentials — API key stays server-side.
 * Signature: SHA256(libraryId + apiKey + expireUnix + videoId) per Bunny docs.
 */
export async function createBunnyTusUploadCredentials(
  cfg: BunnyStreamConfig,
  videoGuid: string,
  ttlSeconds = BUNNY_TUS_UPLOAD_TTL_SECONDS,
): Promise<{
  endpoint: string
  libraryId: string
  videoId: string
  authorizationSignature: string
  authorizationExpire: number
}> {
  const expireUnix = Math.floor(Date.now() / 1000) + ttlSeconds
  const signaturePayload = `${cfg.libraryId}${cfg.apiKey}${expireUnix}${videoGuid}`
  const authorizationSignature = await sha256Hex(signaturePayload)
  return {
    endpoint: BUNNY_TUS_UPLOAD_ENDPOINT,
    libraryId: cfg.libraryId,
    videoId: videoGuid,
    authorizationSignature,
    authorizationExpire: expireUnix,
  }
}

/**
 * POST /library/{libraryId}/videos — creates an empty video slot before upload.
 * Bunny requires this step; the guid returned is used in the subsequent PUT URL.
 */
export async function createBunnyVideo(
  env: WorkerEnv,
  title: string,
): Promise<{ guid: string, libraryId: string }> {
  const cfg = await getBunnyStreamConfig(env)
  if (!cfg.configured) {
    throw new Error('Bunny Stream is not configured')
  }
  const res = await fetch(`${bunnyLibraryUrl(cfg.libraryId)}/videos`, {
    method: 'POST',
    headers: {
      AccessKey: cfg.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ title: title || 'Untitled' }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Bunny create video failed (${res.status}): ${detail.slice(0, 400)}`)
  }
  const payload = await res.json().catch(() => ({})) as { guid?: string, Guid?: string }
  const guid = String(payload?.guid || payload?.Guid || '').trim()
  if (!guid) throw new Error('Bunny create video response missing guid')
  return { guid, libraryId: cfg.libraryId }
}

/**
 * PUT raw video bytes to Bunny (single request body, not multipart).
 * Intended for small in-Worker uploads; admin flow uses browser-direct PUT instead.
 */
export async function uploadVideoToBunny(
  env: WorkerEnv,
  guid: string,
  libraryId: string,
  videoBytes: ReadableStream | ArrayBuffer,
): Promise<{ ok: boolean, status: number }> {
  const cfg = await getBunnyStreamConfig(env)
  const body = videoBytes instanceof ArrayBuffer ? videoBytes : videoBytes
  const res = await fetch(`${bunnyLibraryUrl(libraryId)}/videos/${encodeURIComponent(guid)}`, {
    method: 'PUT',
    headers: { AccessKey: cfg.apiKey },
    body,
  })
  return { ok: res.ok, status: res.status }
}

/**
 * GET video metadata and map Bunny's numeric status to our job statuses.
 * When finished, returns playback + HLS manifest URLs for D1 storage.
 */
export async function pollBunnyVideoStatus(
  env: WorkerEnv,
  guid: string,
  libraryId: string,
): Promise<BunnyVideoStatus> {
  const cfg = await getBunnyStreamConfig(env)
  const res = await fetch(`${bunnyLibraryUrl(libraryId)}/videos/${encodeURIComponent(guid)}`, {
    method: 'GET',
    headers: { AccessKey: cfg.apiKey, Accept: 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Bunny get video failed (${res.status}): ${detail.slice(0, 400)}`)
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  const rawStatus = Number(data.status ?? data.Status ?? -1)
  const status = mapBunnyNumericStatus(rawStatus)
  const result: BunnyVideoStatus = { status, rawStatus }

  if (status === 'finished') {
    const lengthRaw = Number(data.length ?? data.Length ?? data.duration ?? 0)
    if (Number.isFinite(lengthRaw) && lengthRaw > 0) {
      result.durationSeconds = Math.floor(lengthRaw)
    }
    const playbackUrl = String(data.playbackUrl ?? data.PlaybackUrl ?? '').trim()
    if (playbackUrl) result.playbackUrl = playbackUrl

    const hlsManifestUrl = buildBunnyHlsManifestUrl(cfg, guid)
    if (hlsManifestUrl) result.hlsManifestUrl = hlsManifestUrl

    let thumbnailUrl = String(data.thumbnailUrl ?? data.ThumbnailUrl ?? '').trim()
    if (!thumbnailUrl) {
      const fileName = String(data.thumbnailFileName ?? '').trim()
      if (fileName) thumbnailUrl = buildBunnyThumbnailUrl(cfg, guid, fileName)
    } else if (!thumbnailUrl.includes('://')) {
      thumbnailUrl = buildBunnyThumbnailUrl(cfg, guid, thumbnailUrl)
    }
    if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl
  }

  return result
}

/** DELETE removes the video object from the Bunny library (best-effort cleanup). */
export async function deleteBunnyVideo(
  env: WorkerEnv,
  guid: string,
  libraryId: string,
): Promise<void> {
  const cfg = await getBunnyStreamConfig(env)
  const res = await fetch(`${bunnyLibraryUrl(libraryId)}/videos/${encodeURIComponent(guid)}`, {
    method: 'DELETE',
    headers: { AccessKey: cfg.apiKey },
  })
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Bunny delete video failed (${res.status}): ${detail.slice(0, 400)}`)
  }
}

async function upsertVideoDraftRow(
  db: D1Database,
  videoId: string,
  title: string,
  description: string | null,
  categoryId: string | null,
) {
  await db.prepare(`
    INSERT OR IGNORE INTO videos (id, title, description, publish_status, upload_date, full_duration, preview_duration, status, updated_at)
    VALUES (?, ?, ?, 'draft', CURRENT_TIMESTAMP, 0, 0, 'uploaded', CURRENT_TIMESTAMP)
  `).bind(videoId, title, description).run()

  await db.prepare(`
    UPDATE videos
      SET title = COALESCE(NULLIF(?, ''), title),
          description = ?,
          status = 'uploaded',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
  `).bind(title, description, videoId).run()

  if (categoryId) {
    await db.prepare(`
      INSERT INTO video_category_assignments (video_id, category_id, assigned_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(video_id) DO UPDATE SET category_id = excluded.category_id, assigned_at = CURRENT_TIMESTAMP
    `).bind(videoId, categoryId).run()
  }
}

/**
 * POST /api/admin/videos/uploads/bunnystream
 * Creates D1 job + Bunny video object; browser uploads via returned PUT credentials.
 */
export async function handleAdminBunnyStreamUpload(
  request: Request,
  env: WorkerEnv,
  corsHeaders: CorsHeaders,
) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  const cfg = await getBunnyStreamConfig(env)
  if (!cfg.enabled) {
    return jsonResponse({ error: 'Bunny Stream pipeline is disabled' }, 503, corsHeaders)
  }
  if (!cfg.configured) {
    return jsonResponse({ error: 'Bunny Stream pipeline is not fully configured' }, 503, corsHeaders)
  }

  const bodyRaw = await request.json().catch(() => null)
  const body = (bodyRaw && typeof bodyRaw === 'object') ? bodyRaw as Record<string, unknown> : null
  if (!body) return jsonResponse({ error: 'Expected JSON body' }, 400, corsHeaders)

  const fileName = String(body.fileName || '').trim()
  const fileSize = Number(body.fileSize || 0)
  if (!fileName) return jsonResponse({ error: 'fileName is required' }, 400, corsHeaders)
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return jsonResponse({ error: 'fileSize must be > 0' }, 400, corsHeaders)
  }

  const title = String(body.title || 'Untitled upload').trim() || 'Untitled upload'
  const descriptionRaw = String(body.description || '').trim()
  const description = descriptionRaw || null
  const categoryIdRaw = String(body.categoryId || '').trim()
  const categoryId = categoryIdRaw || null

  const db = getDb(env)
  if (!db) return jsonResponse({ error: 'Database not configured' }, 500, corsHeaders)

  if (categoryId) {
    const category = await db.prepare(`SELECT id FROM video_categories WHERE id = ?`).bind(categoryId).first()
    if (!category) return jsonResponse({ error: 'Category not found', code: 'category_not_found' }, 404, corsHeaders)
  }

  const videoId = crypto.randomUUID()
  let bunnyGuid: string
  let libraryId: string
  try {
    const created = await createBunnyVideo(env, title)
    bunnyGuid = created.guid
    libraryId = created.libraryId
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bunny create video failed'
    return jsonResponse({ error: message, code: 'bunnystream_create_failed' }, 502, corsHeaders)
  }

  let jobId: string
  try {
    await upsertVideoDraftRow(db, videoId, title, description, categoryId)

    jobId = crypto.randomUUID()
    const placeholderBucket = 'bunnystream'
    const inputKey = `bunny/${bunnyGuid}/${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const outputPrefix = `bunny/${bunnyGuid}`

    await db.prepare(`
      INSERT INTO media_convert_jobs (
        id, video_id, status, provider, bunny_guid, aws_job_id,
        input_bucket, input_key, output_bucket, output_prefix,
        renditions_json, input_duration_seconds, normalized_minutes_est, cost_est_usd,
        created_at, updated_at
      )
      VALUES (?, ?, 'uploaded', 'bunnystream', ?, ?, ?, ?, ?, ?, '[]', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      jobId, videoId, bunnyGuid, bunnyGuid,
      placeholderBucket, inputKey, placeholderBucket, outputPrefix,
    ).run()
  } catch (err) {
    try {
      await deleteBunnyVideo(env, bunnyGuid, libraryId)
    } catch {
      // Best-effort: remove orphaned Bunny slot if local persistence failed.
    }
    const message = err instanceof Error ? err.message : 'Failed to persist Bunny upload job'
    return jsonResponse({ error: message, code: 'bunnystream_persist_failed' }, 500, corsHeaders)
  }

  const tus = await createBunnyTusUploadCredentials(cfg, bunnyGuid)

  return jsonResponse({
    ok: true,
    videoId,
    bunnyGuid,
    job: { id: jobId, status: 'uploaded' },
    upload: {
      method: 'TUS',
      endpoint: tus.endpoint,
      headers: {
        AuthorizationSignature: tus.authorizationSignature,
        AuthorizationExpire: String(tus.authorizationExpire),
        LibraryId: tus.libraryId,
        VideoId: tus.videoId,
      },
    },
  }, 201, corsHeaders)
}

/**
 * POST /api/admin/videos/uploads/bunnystream/complete
 * Called after browser finishes PUT upload; Bunny begins transcoding automatically.
 */
export async function handleAdminBunnyStreamUploadComplete(
  request: Request,
  env: WorkerEnv,
  corsHeaders: CorsHeaders,
) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  const cfg = await getBunnyStreamConfig(env)
  if (!cfg.enabled || !cfg.configured) {
    return jsonResponse({ error: 'Bunny Stream pipeline is not configured' }, 503, corsHeaders)
  }

  const bodyRaw = await request.json().catch(() => null)
  const body = (bodyRaw && typeof bodyRaw === 'object') ? bodyRaw as Record<string, unknown> : null
  const jobId = String(body?.jobId || '').trim()
  if (!jobId) return jsonResponse({ error: 'jobId is required' }, 400, corsHeaders)

  const db = getDb(env)
  if (!db) return jsonResponse({ error: 'Database not configured' }, 500, corsHeaders)

  const job = await db.prepare(`
    SELECT id, video_id, bunny_guid, provider
    FROM media_convert_jobs
    WHERE id = ?
    LIMIT 1
  `).bind(jobId).first() as { id: string, video_id: string, bunny_guid: string | null, provider: string } | null

  if (!job) return jsonResponse({ error: 'Upload job not found' }, 404, corsHeaders)
  if (job.provider !== 'bunnystream') {
    return jsonResponse({ error: 'Job is not a Bunny Stream upload' }, 400, corsHeaders)
  }

  const bunnyGuid = String(job.bunny_guid || '').trim()
  if (!bunnyGuid) {
    return jsonResponse({ error: 'Job missing bunny_guid' }, 400, corsHeaders)
  }

  await db.batch([
    db.prepare(`
      UPDATE media_convert_jobs
      SET aws_job_id = ?, status = 'queued', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(bunnyGuid, jobId),
    db.prepare(`
      UPDATE videos SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(job.video_id),
  ])

  return jsonResponse({ ok: true, jobId, bunnyGuid, status: 'queued' }, 200, corsHeaders)
}

/** Mask API key for admin settings GET (same pattern as MediaConvert secrets). */
export function maskBunnySecret(value: string): string {
  if (!value) return ''
  if (value.length <= 6) return '••••••'
  return `${value.slice(0, 2)}••••••${value.slice(-4)}`
}

/** Build admin UI config object for GET /api/admin/system/mediaconvert. */
export async function getBunnyStreamAdminSettings(env: WorkerEnv) {
  const settings = await getSettings(env, [
    'bunnynet_stream_enabled',
    'bunnynet_stream_library_id',
    'bunnynet_stream_api_key',
    'bunnynet_stream_pull_zone',
    'bunnynet_stream_cdn_hostname',
  ])
  const raw = (key: string, envKey: string, fallback = '') => {
    const fromSettings = String(settings[key] ?? '').trim()
    if (fromSettings) return fromSettings
    return envTrim(env, envKey, fallback)
  }
  const cfg = await getBunnyStreamConfig(env)
  return {
    enabled: raw('bunnynet_stream_enabled', 'BUNNYNET_STREAM_ENABLED', '0') === '1',
    configured: cfg.configured,
    libraryId: raw('bunnynet_stream_library_id', 'BUNNYNET_STREAM_LIBRARY_ID'),
    pullZone: raw('bunnynet_stream_pull_zone', 'BUNNYNET_STREAM_PULL_ZONE'),
    cdnHostname: raw('bunnynet_stream_cdn_hostname', 'BUNNYNET_STREAM_CDN_HOSTNAME'),
    secrets: {
      apiKeyMasked: maskBunnySecret(raw('bunnynet_stream_api_key', 'BUNNYNET_STREAM_API_KEY')),
    },
  }
}

/** Apply PATCH fields for Bunny Stream from admin system settings body. */
export async function patchBunnyStreamAdminSettings(
  env: WorkerEnv,
  body: Record<string, unknown>,
): Promise<[string, string][]> {
  const updates: [string, string][] = []
  const bunny = body.bunnyStream
  if (!bunny || typeof bunny !== 'object') return updates
  const b = bunny as Record<string, unknown>
  const getString = (key: string) => String(b[key] ?? '').trim()
  if (Object.prototype.hasOwnProperty.call(b, 'enabled')) {
    updates.push(['bunnynet_stream_enabled', b.enabled === true ? '1' : '0'])
  }
  if (Object.prototype.hasOwnProperty.call(b, 'libraryId')) {
    updates.push(['bunnynet_stream_library_id', getString('libraryId')])
  }
  if (Object.prototype.hasOwnProperty.call(b, 'apiKey')) {
    updates.push(['bunnynet_stream_api_key', getString('apiKey')])
  }
  if (Object.prototype.hasOwnProperty.call(b, 'pullZone')) {
    updates.push(['bunnynet_stream_pull_zone', getString('pullZone')])
  }
  if (Object.prototype.hasOwnProperty.call(b, 'cdnHostname')) {
    updates.push(['bunnynet_stream_cdn_hostname', getString('cdnHostname')])
  }
  return updates
}
