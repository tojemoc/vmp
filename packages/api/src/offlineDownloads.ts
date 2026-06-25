/**
 * Offline downloads API — device registration (M1) and download licensing (M2).
 *
 * V1 uses Store & License: plaintext CMAF in OPFS on the client; server gates
 * authorize/asset access. See docs/offline-downloads-roadmap.md.
 */

import { requireAuth } from './auth.js'
import { isAdministrativeRole } from './roles.js'
import { getSetting } from './settingsStore.js'
import { signDownloadToken, verifyDownloadToken } from './downloadTokens.js'
import {
  buildOfflineManifest,
  computeManifestHash,
  createBucketOfflineR2Reader,
  createHttpOfflineR2Reader,
  estimateDownloadBytes,
  isOfflineRendition,
  parseLicensedManifestPaths,
  sha256HexFromString,
} from './offlineManifest.js'
import type { OfflineRendition } from '@vmp/shared'
import { resolveMediaEntrypointUrl } from './mediaEntrypoints.js'

const DEVICE_TOKEN_HEADER = 'x-vmp-device-token'

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function errorResponse(error: string, status: number, corsHeaders: Record<string, string>, code?: string) {
  return jsonResponse(code ? { error, code } : { error }, status, corsHeaders)
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('')
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function normalizeDeviceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 120) return null
  return trimmed
}

function parseJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  return request.json().catch(() => ({})) as Promise<T>
}

interface OfflineSettings {
  maxLicenseDays: number
  revalidationDays: number
  deviceLimitDefault: number
  deviceLimitClub: number
}

async function getOfflineSettings(env: any): Promise<OfflineSettings> {
  const [maxLicenseDaysRaw, revalidationDaysRaw, deviceLimitDefaultRaw, deviceLimitClubRaw] = await Promise.all([
    getSetting(env, 'offline_max_license_days', { ttlSeconds: 300, defaultValue: '30' }),
    getSetting(env, 'offline_revalidation_days', { ttlSeconds: 300, defaultValue: '7' }),
    getSetting(env, 'offline_device_limit_default', { ttlSeconds: 300, defaultValue: '5' }),
    getSetting(env, 'offline_device_limit_club', { ttlSeconds: 300, defaultValue: '10' }),
  ])

  return {
    maxLicenseDays: Math.max(1, Number.parseInt(String(maxLicenseDaysRaw ?? '30'), 10) || 30),
    revalidationDays: Math.max(1, Number.parseInt(String(revalidationDaysRaw ?? '7'), 10) || 7),
    deviceLimitDefault: Math.max(1, Number.parseInt(String(deviceLimitDefaultRaw ?? '5'), 10) || 5),
    deviceLimitClub: Math.max(1, Number.parseInt(String(deviceLimitClubRaw ?? '10'), 10) || 10),
  }
}

async function getActiveSubscription(db: any, userId: string) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ?
      AND status IN ('active', 'trialing')
      AND (current_period_end IS NULL OR datetime(current_period_end) > CURRENT_TIMESTAMP)
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId).first()
}

function deviceLimitForPlan(planType: unknown, settings: OfflineSettings): number {
  const plan = String(planType ?? '').trim().toLowerCase()
  return plan === 'club' ? settings.deviceLimitClub : settings.deviceLimitDefault
}

function computeLicenseExpiresAt(subscription: any, settings: OfflineSettings): string {
  const now = Date.now()
  const policyMax = new Date(now + settings.maxLicenseDays * 24 * 60 * 60 * 1000)
  const subEndRaw = subscription?.current_period_end
  if (!subEndRaw) return policyMax.toISOString()
  const subEnd = new Date(subEndRaw)
  if (Number.isNaN(subEnd.getTime())) return policyMax.toISOString()
  return (subEnd.getTime() < policyMax.getTime() ? subEnd : policyMax).toISOString()
}

async function signOfflineLicensePayload(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
}

async function buildSignedLicense({
  licenseRow,
  settings,
  secret,
}: {
  licenseRow: any
  settings: OfflineSettings
  secret: string
}) {
  const expiresAt = String(licenseRow.expires_at)
  const nextValidationDueAt = new Date(
    Date.now() + settings.revalidationDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  const unsigned = {
    licenseId: licenseRow.id,
    deviceId: licenseRow.device_id,
    videoId: licenseRow.video_id,
    rendition: licenseRow.rendition,
    expiresAt,
    manifestHash: licenseRow.manifest_hash,
    manifestVersion: licenseRow.manifest_version,
    playbackState: licenseRow.status === 'active' ? 'allowed' : licenseRow.status,
    nextValidationDueAt,
  }

  const signature = await signOfflineLicensePayload(unsigned, secret)
  return { ...unsigned, signature }
}

async function authenticateDevice(request: Request, env: any, db: any) {
  const token = request.headers.get(DEVICE_TOKEN_HEADER)?.trim()
  if (!token) return { ok: false as const, status: 401, error: 'Missing device token', code: 'missing_device_token' }

  const tokenHash = await sha256Hex(token)
  const device = await db.prepare(`
    SELECT * FROM offline_devices
    WHERE device_token_hash = ? AND revoked_at IS NULL
    LIMIT 1
  `).bind(tokenHash).first()

  if (!device) {
    return { ok: false as const, status: 401, error: 'Invalid device token', code: 'invalid_device_token' }
  }

  await db.prepare(`
    UPDATE offline_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(device.id).run()

  return { ok: true as const, device }
}

export async function revokeOfflineLicensesForUser(db: any, userId: string, reason: string) {
  await db.prepare(`
    UPDATE offline_download_licenses
    SET status = 'revoked',
        revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = ?
    WHERE user_id = ?
      AND status = 'active'
  `).bind(reason, userId).run()
}

// ── Device registration ───────────────────────────────────────────────────────

export async function handleRegisterOfflineDevice(request: Request, env: any, corsHeaders: Record<string, string>) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders)
  }

  const body = await parseJsonBody<{ deviceName?: unknown, publicKey?: unknown }>(request)
  const deviceName = normalizeDeviceName(body.deviceName)
  if (!deviceName) return errorResponse('deviceName is required (1–120 chars)', 400, corsHeaders)

  const publicKey = typeof body.publicKey === 'string' && body.publicKey.trim()
    ? body.publicKey.trim().slice(0, 4096)
    : null

  const db = getDb(env)
  const settings = await getOfflineSettings(env)

  if (!isAdministrativeRole(user.role)) {
    const subscription = await getActiveSubscription(db, user.sub)
    if (!subscription) {
      return errorResponse('Active subscription required for offline downloads', 403, corsHeaders, 'subscription_required')
    }

    const limit = deviceLimitForPlan(subscription.plan_type, settings)
    const deviceId = crypto.randomUUID()
    const deviceToken = generateOpaqueToken()
    const deviceTokenHash = await sha256Hex(deviceToken)

    const insertResult = await db.prepare(`
      INSERT INTO offline_devices (id, user_id, device_name, public_key, device_token_hash, registered_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE (SELECT COUNT(*) FROM offline_devices WHERE user_id = ? AND revoked_at IS NULL) < ?
    `).bind(deviceId, user.sub, deviceName, publicKey, deviceTokenHash, user.sub, limit).run()

    if (!insertResult.meta?.changes) {
      return errorResponse('Device limit reached', 409, corsHeaders, 'device_limit_reached')
    }

    return jsonResponse({
      deviceId,
      deviceToken,
      deviceName,
      registeredAt: new Date().toISOString(),
    }, 201, corsHeaders)
  }

  const deviceId = crypto.randomUUID()
  const deviceToken = generateOpaqueToken()
  const deviceTokenHash = await sha256Hex(deviceToken)

  await db.prepare(`
    INSERT INTO offline_devices (id, user_id, device_name, public_key, device_token_hash, registered_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(deviceId, user.sub, deviceName, publicKey, deviceTokenHash).run()

  return jsonResponse({
    deviceId,
    deviceToken,
    deviceName,
    registeredAt: new Date().toISOString(),
  }, 201, corsHeaders)
}

export async function handleListOfflineDevices(request: Request, env: any, corsHeaders: Record<string, string>) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders)
  }

  const db = getDb(env)
  const { results } = await db.prepare(`
    SELECT id, device_name, public_key, registered_at, last_seen_at, revoked_at
    FROM offline_devices
    WHERE user_id = ?
    ORDER BY registered_at DESC
  `).bind(user.sub).all()

  const devices = (results ?? []).map((row: any) => ({
    deviceId: row.id,
    deviceName: row.device_name,
    hasPublicKey: Boolean(row.public_key),
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    active: !row.revoked_at,
  }))

  return jsonResponse({ devices }, 200, corsHeaders)
}

export async function handleRevokeOfflineDevice(
  request: Request,
  env: any,
  corsHeaders: Record<string, string>,
  deviceId: string,
) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders)
  }

  const db = getDb(env)
  const device = await db.prepare(`
    SELECT id FROM offline_devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1
  `).bind(deviceId, user.sub).first()

  if (!device) return errorResponse('Device not found', 404, corsHeaders)

  await db.prepare(`
    UPDATE offline_devices SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(deviceId).run()

  await db.prepare(`
    UPDATE offline_download_licenses
    SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'device_revoked'
    WHERE device_id = ? AND status = 'active'
  `).bind(deviceId).run()

  return jsonResponse({ ok: true, deviceId }, 200, corsHeaders)
}

async function hasR2HostedHlsAssets(env: any, videoId: string): Promise<boolean> {
  if (env.BUCKET) {
    const candidates = [
      `videos/${videoId}/master.m3u8`,
      `videos/${videoId}/processed/hls/master.m3u8`,
      `videos/${videoId}/processed/playlist.m3u8`,
    ]
    for (const key of candidates) {
      const object = await env.BUCKET.head(key)
      if (object) return true
    }
    return false
  }

  const entrypoint = await resolveMediaEntrypointUrl({
    env,
    videoId,
    bunnyPlaybackUrl: null,
  })
  return Boolean(entrypoint && String(entrypoint).includes(`/videos/${videoId}/`))
}

function createOfflineR2Reader(env: any, videoId: string) {
  if (env.BUCKET) return createBucketOfflineR2Reader(env.BUCKET, videoId)
  if (env.R2_BASE_URL) return createHttpOfflineR2Reader(env.R2_BASE_URL, videoId)
  return null
}

function parseRangeHeader(rangeHeader: string | null): { offset: number, length?: number } | undefined {
  if (!rangeHeader) return undefined
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/i)
  if (!match) return undefined
  const offsetRaw = match[1]
  if (!offsetRaw) return undefined
  const offset = Number.parseInt(offsetRaw, 10)
  if (!Number.isFinite(offset) || offset < 0) return undefined
  if (!match[2]) return { offset }
  const end = Number.parseInt(match[2], 10)
  if (!Number.isFinite(end) || end < offset) return undefined
  return { offset, length: end - offset + 1 }
}

// ── Download licensing ────────────────────────────────────────────────────────

async function resolvePublishedVideo(db: any, videoId: string, authRole: unknown) {
  const video = await db.prepare(`
    SELECT id, title, full_duration, preview_duration, publish_status
    FROM videos
    WHERE id = ? OR slug = ?
    LIMIT 1
  `).bind(videoId, videoId).first()

  if (!video) return null
  if (video.publish_status !== 'published' && !isAdministrativeRole(authRole)) return null
  return video
}

export async function handleAuthorizeDownload(
  request: Request,
  env: any,
  corsHeaders: Record<string, string>,
  videoIdParam: string,
) {
  if (!env.JWT_SECRET) return errorResponse('Offline downloads not configured', 503, corsHeaders)

  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders)
  }

  const deviceAuth = await authenticateDevice(request, env, getDb(env))
  if (!deviceAuth.ok) {
    return errorResponse(deviceAuth.error, deviceAuth.status, corsHeaders, deviceAuth.code)
  }
  const device = deviceAuth.device
  if (device.user_id !== user.sub) {
    return errorResponse('Device token does not match authenticated user', 403, corsHeaders, 'device_user_mismatch')
  }

  const body = await parseJsonBody<{ rendition?: unknown, deviceId?: unknown }>(request)
  const rendition = body.rendition
  if (!isOfflineRendition(rendition)) {
    return errorResponse('rendition must be 480p, 720p, or 1080p', 400, corsHeaders)
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : device.id
  if (deviceId !== device.id) {
    return errorResponse('deviceId does not match device token', 403, corsHeaders, 'device_id_mismatch')
  }

  const db = getDb(env)
  const settings = await getOfflineSettings(env)

  const hasPremium = isAdministrativeRole(user.role) || Boolean(await getActiveSubscription(db, user.sub))
  if (!hasPremium) {
    return errorResponse('Active subscription required', 403, corsHeaders, 'subscription_required')
  }

  const video = await resolvePublishedVideo(db, videoIdParam, user.role)
  if (!video) return errorResponse('Video not found', 404, corsHeaders)

  const resolvedVideoId = String(video.id)

  const bunnyRow = await db.prepare(`
    SELECT bunny_playback_url FROM media_convert_jobs
    WHERE video_id = ? AND provider = 'bunnystream' AND status = 'completed'
      AND bunny_playback_url IS NOT NULL AND TRIM(bunny_playback_url) != ''
    ORDER BY completed_at DESC, created_at DESC LIMIT 1
  `).bind(resolvedVideoId).first()

  const hasR2Assets = await hasR2HostedHlsAssets(env, resolvedVideoId)
  if (!hasR2Assets) {
    const entrypoint = await resolveMediaEntrypointUrl({
      env,
      videoId: resolvedVideoId,
      bunnyPlaybackUrl: bunnyRow?.bunny_playback_url ?? null,
    })
    const reason = entrypoint && !String(entrypoint).includes(`/videos/${resolvedVideoId}/`)
      ? 'Offline download requires R2-hosted HLS assets for this video'
      : 'No HLS master playlist found in R2 for this video'
    return errorResponse(reason, 409, corsHeaders, 'r2_assets_required')
  }

  const reader = createOfflineR2Reader(env, resolvedVideoId)
  if (!reader) return errorResponse('R2 not configured', 503, corsHeaders)

  let manifest
  try {
    manifest = await buildOfflineManifest({
      reader,
      videoId: resolvedVideoId,
      rendition,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to build download manifest'
    return errorResponse(message, 409, corsHeaders, 'manifest_unavailable')
  }

  const manifestHash = await sha256HexFromString(computeManifestHash(manifest.files))
  const manifestPathsJson = JSON.stringify(manifest.files.map(f => f.path))
  const subscription = await getActiveSubscription(db, user.sub)
  const expiresAt = computeLicenseExpiresAt(subscription, settings)
  const licenseId = crypto.randomUUID()

  await db.prepare(`
    INSERT INTO offline_download_licenses (
      id, user_id, video_id, device_id, rendition, status,
      issued_at, expires_at, manifest_hash, manifest_paths, manifest_version
    ) VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?, ?, ?)
    ON CONFLICT(user_id, video_id, rendition, device_id) DO UPDATE SET
      status = 'active',
      issued_at = CURRENT_TIMESTAMP,
      expires_at = excluded.expires_at,
      last_renewed_at = CURRENT_TIMESTAMP,
      revoked_at = NULL,
      revoked_reason = NULL,
      manifest_hash = excluded.manifest_hash,
      manifest_paths = excluded.manifest_paths,
      manifest_version = excluded.manifest_version
  `).bind(
    licenseId,
    user.sub,
    resolvedVideoId,
    deviceId,
    rendition,
    expiresAt,
    manifestHash,
    manifestPathsJson,
    manifest.manifestVersion,
  ).run()

  const licenseRow = await db.prepare(`
    SELECT * FROM offline_download_licenses
    WHERE user_id = ? AND video_id = ? AND rendition = ? AND device_id = ?
    LIMIT 1
  `).bind(user.sub, resolvedVideoId, rendition, deviceId).first()

  const license = await buildSignedLicense({
    licenseRow,
    settings,
    secret: env.JWT_SECRET,
  })

  const downloadToken = await signDownloadToken(
    user.sub,
    String(licenseRow.id),
    deviceId,
    env.JWT_SECRET,
    { ttlSeconds: settings.maxLicenseDays * 24 * 60 * 60 },
  )

  const durationSec = Number(video.full_duration ?? 0) || 0
  const estimatedBytes = manifest.totalBytes > 0
    ? manifest.totalBytes
    : estimateDownloadBytes(durationSec, rendition)

  return jsonResponse({
    license,
    manifest,
    downloadToken,
    estimatedBytes,
    video: {
      id: resolvedVideoId,
      title: video.title,
      fullDuration: durationSec,
    },
  }, 200, corsHeaders)
}

export async function handleDownloadAsset(
  request: Request,
  env: any,
  corsHeaders: Record<string, string>,
  videoIdParam: string,
  assetPath: string,
) {
  if (!env.JWT_SECRET || (!env.BUCKET && !env.R2_BASE_URL)) {
    return errorResponse('Offline downloads not configured', 503, corsHeaders)
  }

  const dt = new URL(request.url).searchParams.get('dt')?.trim()
  if (!dt) return errorResponse('Missing download token', 403, corsHeaders, 'missing_download_token')

  let claims
  try {
    claims = await verifyDownloadToken(dt, env.JWT_SECRET)
  } catch {
    return errorResponse('Invalid or expired download token', 403, corsHeaders, 'invalid_download_token')
  }

  const db = getDb(env)
  const video = await db.prepare('SELECT id FROM videos WHERE id = ? OR slug = ? LIMIT 1')
    .bind(videoIdParam, videoIdParam).first()
  if (!video) return errorResponse('Video not found', 404, corsHeaders)
  const resolvedVideoId = String(video.id)

  if (claims.userId === undefined || claims.licenseId === undefined) {
    return errorResponse('Invalid download token', 403, corsHeaders)
  }

  const license = await db.prepare(`
    SELECT * FROM offline_download_licenses
    WHERE id = ? AND user_id = ? AND video_id = ? AND device_id = ?
      AND status = 'active'
      AND datetime(expires_at) > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(claims.licenseId, claims.userId, resolvedVideoId, claims.deviceId).first()

  if (!license) {
    return errorResponse('Download license invalid or expired', 403, corsHeaders, 'license_invalid')
  }

  const normalizedAsset = assetPath.replace(/^\/+/, '')
  if (!normalizedAsset || normalizedAsset.includes('..')) {
    return errorResponse('Invalid asset path', 400, corsHeaders)
  }

  const licensedPaths = parseLicensedManifestPaths(license.manifest_paths)
  if (!licensedPaths?.has(normalizedAsset)) {
    return errorResponse('Asset not covered by download license', 403, corsHeaders, 'asset_not_licensed')
  }

  const objectPath = `videos/${resolvedVideoId}/${normalizedAsset}`

  if (env.BUCKET) {
    const range = parseRangeHeader(request.headers.get('Range'))
    const object = await env.BUCKET.get(objectPath, range ? { range } : undefined)
    if (!object) return errorResponse('Asset not found', 404, corsHeaders)

    const headers = new Headers()
    if (object.httpMetadata?.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType)
    }
    if (object.size !== undefined) {
      headers.set('Content-Length', String(object.size))
    }
    if (object.range) {
      headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`)
      headers.set('Accept-Ranges', 'bytes')
    }
    headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'] ?? '*')
    if (corsHeaders['Access-Control-Allow-Credentials']) {
      headers.set('Access-Control-Allow-Credentials', corsHeaders['Access-Control-Allow-Credentials'])
    }
    headers.set('Cache-Control', 'private, no-store')

    return new Response(object.body, {
      status: object.range ? 206 : 200,
      headers,
    })
  }

  if (!env.R2_BASE_URL) return errorResponse('R2 not configured', 503, corsHeaders)

  const upstreamUrl = `${env.R2_BASE_URL.replace(/\/+$/, '')}/${objectPath}`

  const upstreamHeaders = new Headers()
  const rangeHeader = request.headers.get('Range')
  if (rangeHeader) upstreamHeaders.set('Range', rangeHeader)

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, { headers: upstreamHeaders })
  } catch {
    return errorResponse('Failed to fetch asset', 502, corsHeaders)
  }

  if (!upstreamRes.ok) {
    return errorResponse('Asset not found', upstreamRes.status === 404 ? 404 : 502, corsHeaders)
  }

  const headers = new Headers(upstreamRes.headers)
  headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'] ?? '*')
  if (corsHeaders['Access-Control-Allow-Credentials']) {
    headers.set('Access-Control-Allow-Credentials', corsHeaders['Access-Control-Allow-Credentials'])
  }
  headers.set('Cache-Control', 'private, no-store')

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers,
  })
}

export async function handleRenewDownloadLicenses(request: Request, env: any, corsHeaders: Record<string, string>) {
  if (!env.JWT_SECRET) return errorResponse('Offline downloads not configured', 503, corsHeaders)

  const db = getDb(env)
  const deviceAuth = await authenticateDevice(request, env, db)
  if (!deviceAuth.ok) {
    return errorResponse(deviceAuth.error, deviceAuth.status, corsHeaders, deviceAuth.code)
  }
  const device = deviceAuth.device

  const body = await parseJsonBody<{ licenseIds?: unknown }>(request)
  const licenseIds = Array.isArray(body.licenseIds)
    ? body.licenseIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (licenseIds.length === 0) {
    return errorResponse('licenseIds array is required', 400, corsHeaders)
  }
  if (licenseIds.length > 50) {
    return errorResponse('Too many licenseIds (max 50)', 400, corsHeaders)
  }

  const settings = await getOfflineSettings(env)
  const subscription = await getActiveSubscription(db, device.user_id)
  const userRow = await db.prepare('SELECT role FROM users WHERE id = ? LIMIT 1').bind(device.user_id).first()
  const hasPremium = isAdministrativeRole(userRow?.role) || Boolean(subscription)

  const results = []
  for (const licenseId of licenseIds) {
    const licenseRow = await db.prepare(`
      SELECT * FROM offline_download_licenses
      WHERE id = ? AND user_id = ? AND device_id = ?
      LIMIT 1
    `).bind(licenseId, device.user_id, device.id).first()

    if (!licenseRow) {
      results.push({ licenseId, status: 'not_found' })
      continue
    }

    if (!hasPremium) {
      await db.prepare(`
        UPDATE offline_download_licenses
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'subscription_lapsed'
        WHERE id = ?
      `).bind(licenseId).run()
      results.push({ licenseId, status: 'revoked', reason: 'subscription_lapsed' })
      continue
    }

    const expiresAt = computeLicenseExpiresAt(subscription, settings)
    await db.prepare(`
      UPDATE offline_download_licenses
      SET status = 'active',
          expires_at = ?,
          last_renewed_at = CURRENT_TIMESTAMP,
          revoked_at = NULL,
          revoked_reason = NULL
      WHERE id = ?
    `).bind(expiresAt, licenseId).run()

    const updated = await db.prepare('SELECT * FROM offline_download_licenses WHERE id = ? LIMIT 1')
      .bind(licenseId).first()
    const license = await buildSignedLicense({
      licenseRow: updated,
      settings,
      secret: env.JWT_SECRET,
    })

    results.push({ licenseId, status: 'renewed', license, expiresAt })
  }

  return jsonResponse({ results }, 200, corsHeaders)
}

export async function handleListDownloads(request: Request, env: any, corsHeaders: Record<string, string>) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders)
  }

  const db = getDb(env)
  const { results } = await db.prepare(`
    SELECT l.id, l.video_id, l.device_id, l.rendition, l.status, l.issued_at,
           l.expires_at, l.last_renewed_at, l.manifest_hash, l.manifest_version,
           v.title AS video_title
    FROM offline_download_licenses l
    LEFT JOIN videos v ON v.id = l.video_id
    WHERE l.user_id = ?
    ORDER BY l.issued_at DESC
  `).bind(user.sub).all()

  const downloads = (results ?? []).map((row: any) => ({
    licenseId: row.id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    deviceId: row.device_id,
    rendition: row.rendition,
    status: row.status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    lastRenewedAt: row.last_renewed_at,
    manifestHash: row.manifest_hash,
    manifestVersion: row.manifest_version,
  }))

  return jsonResponse({ downloads }, 200, corsHeaders)
}

export async function handleRevokeDownload(
  request: Request,
  env: any,
  corsHeaders: Record<string, string>,
  videoIdParam: string,
) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders)
  }

  const body = await parseJsonBody<{ deviceId?: unknown, rendition?: unknown }>(request)
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : null
  const rendition = isOfflineRendition(body.rendition) ? body.rendition : null

  const db = getDb(env)
  const video = await db.prepare('SELECT id FROM videos WHERE id = ? OR slug = ? LIMIT 1')
    .bind(videoIdParam, videoIdParam).first()
  if (!video) return errorResponse('Video not found', 404, corsHeaders)

  let query = `
    UPDATE offline_download_licenses
    SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'user_revoked'
    WHERE user_id = ? AND video_id = ? AND status = 'active'
  `
  const binds: unknown[] = [user.sub, video.id]
  if (deviceId) {
    query += ' AND device_id = ?'
    binds.push(deviceId)
  }
  if (rendition) {
    query += ' AND rendition = ?'
    binds.push(rendition)
  }

  const result = await db.prepare(query).bind(...binds).run()
  return jsonResponse({ ok: true, revokedCount: result.meta?.changes ?? 0 }, 200, corsHeaders)
}

export { DEVICE_TOKEN_HEADER }
