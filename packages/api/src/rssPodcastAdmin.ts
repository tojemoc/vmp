/**
 * Admin-only webhook to notify a host-side script when preview podcast assets may need re-encoding
 * (e.g. after preview_duration changes). The Worker cannot run ffmpeg; the receiver runs on the media host.
 */

import { requireRole } from './auth.js'
import { ensureAdminSettingsTable } from './adminSettingsTable.js'
import { needsPodcastPreviewMp3 } from './podcastPreview.js'
import { getSetting, setSettings } from './settingsStore.js'

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
}

function mapVideosForRebuildPayload(videos: any[]) {
  return videos
    .filter((v) => v?.id && needsPodcastPreviewMp3(v.preview_duration, v.full_duration))
    .map((v: any) => ({
      id: v.id,
      previewDurationSeconds: Number(v.preview_duration) || 0,
      fullDurationSeconds: Number(v.full_duration) || 0,
      updatedAt: v.updated_at ?? null,
    }))
}

/** POST signed rebuild payload to the media host (no HTTP response wrapper). */
export async function deliverPodcastPreviewRebuildWebhook(env: any, videos: any[]) {
  const freePreviewEnabled = String(await getSetting(env, 'rss_free_preview_enabled', { defaultValue: '1' }) ?? '1') === '1'
  if (!freePreviewEnabled) {
    return {
      delivered: false,
      code: 'free_preview_disabled',
      videoCount: 0,
      eligibleCount: 0,
      skippedFullUnlockCount: 0,
    }
  }

  const webhookUrl = (await getSetting(env, 'podcast_rebuild_webhook_url', { defaultValue: '' }))?.trim()
  const secret = (await getSetting(env, 'podcast_rebuild_webhook_secret', { defaultValue: '' }))?.trim()
  if (!webhookUrl || !secret) {
    return {
      delivered: false,
      code: !webhookUrl ? 'webhook_not_configured' : 'secret_not_configured',
      videoCount: videos.length,
      eligibleCount: 0,
      skippedFullUnlockCount: videos.filter((v) =>
        v?.id && !needsPodcastPreviewMp3(v.preview_duration, v.full_duration),
      ).length,
    }
  }

  const payloadVideos = mapVideosForRebuildPayload(videos)
  const skippedFullUnlockCount = Math.max(0, videos.length - payloadVideos.length)
  if (!payloadVideos.length) {
    return {
      delivered: false,
      code: 'nothing_to_rebuild',
      videoCount: videos.length,
      eligibleCount: 0,
      skippedFullUnlockCount,
    }
  }

  const payload = {
    event: 'podcast_preview_rebuild',
    sentAt: new Date().toISOString(),
    videos: payloadVideos,
  }

  const rawBody = JSON.stringify(payload)
  const ts = String(Math.floor(Date.now() / 1000))
  const signature = await hmacSha256Hex(secret, `${ts}.${rawBody}`)

  const controller = new AbortController()
  const timeoutMs = 10000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VMP-Signature': `sha256=${signature}`,
        'X-VMP-Timestamp': ts,
      },
      body: rawBody,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const text = await res.text().catch(() => '')
    const parsed = (() => {
      try {
        return text ? JSON.parse(text) : null
      } catch {
        return null
      }
    })()

    if (!res.ok) {
      return {
        delivered: false,
        code: 'webhook_failed',
        videoCount: videos.length,
        eligibleCount: payloadVideos.length,
        skippedFullUnlockCount,
        webhookStatus: res.status,
        detail: typeof parsed?.error === 'string' ? parsed.error : text.slice(0, 500),
      }
    }

    const acceptedNum = Number(parsed?.acceptedCount ?? payloadVideos.length)
    const rejectedNum = Number(parsed?.rejectedCount ?? 0)
    return {
      delivered: true,
      code: 'delivered',
      videoCount: videos.length,
      eligibleCount: payloadVideos.length,
      skippedFullUnlockCount,
      webhookStatus: res.status,
      acceptedCount: Number.isFinite(acceptedNum) ? acceptedNum : 0,
      rejectedCount: Number.isFinite(rejectedNum) ? rejectedNum : 0,
      rejected: Array.isArray(parsed?.rejected) ? parsed.rejected : [],
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    console.error('deliverPodcastPreviewRebuildWebhook:', err)
    return {
      delivered: false,
      code: isAbort ? 'webhook_timeout' : 'webhook_error',
      videoCount: videos.length,
      eligibleCount: payloadVideos.length,
      skippedFullUnlockCount,
    }
  }
}

async function listPublishedVideosForRebuild(db: any) {
  try {
    const q = await db.prepare(`
      SELECT id, preview_duration, full_duration, updated_at
      FROM videos
      WHERE publish_status = 'published'
      ORDER BY datetime(published_at) DESC, datetime(upload_date) DESC
    `).all()
    return q.results || []
  } catch {
    const q = await db.prepare(`
      SELECT id, preview_duration, full_duration, updated_at
      FROM videos
      WHERE visibility = 'public'
      ORDER BY datetime(published_at) DESC, datetime(upload_date) DESC
    `).all()
    return q.results || []
  }
}

export async function handleRssPodcastWebhookConfig(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  try {
    const db = getDb(env)
    await ensureAdminSettingsTable(db)

    if (request.method === 'GET') {
      const [url, secretSet] = await Promise.all([
        getSetting(env, 'podcast_rebuild_webhook_url', { defaultValue: null }),
        getSetting(env, 'podcast_rebuild_webhook_secret_set', { defaultValue: null }),
      ])
      return jsonResponse({
        webhookUrl: typeof url === 'string' ? url : (url ?? ''),
        secretConfigured: secretSet === '1' || secretSet === 1,
      }, 200, corsHeaders)
    }

    if (request.method !== 'PATCH') {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
    }

    const body = await request.json().catch(() => null)
    const rawUrl = typeof body?.webhookUrl === 'string' ? body.webhookUrl.trim() : ''
    const secretRaw = typeof body?.webhookSecret === 'string' ? body.webhookSecret : null

    let webhookUrl: string | null = rawUrl || null
    if (webhookUrl) {
      try {
        const u = new URL(webhookUrl)
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          return jsonResponse({ error: 'webhookUrl must be http(s)' }, 400, corsHeaders)
        }
      } catch {
        return jsonResponse({ error: 'Invalid webhookUrl' }, 400, corsHeaders)
      }
    }

    const rows: [string, string][] = [['podcast_rebuild_webhook_url', webhookUrl ?? '']]
    if (secretRaw != null) {
      const trimmed = secretRaw.trim()
      if (trimmed.length === 0) {
        rows.push(['podcast_rebuild_webhook_secret', ''])
        rows.push(['podcast_rebuild_webhook_secret_set', '0'])
      } else if (trimmed.length < 16) {
        return jsonResponse({ error: 'webhookSecret must be at least 16 characters when set' }, 400, corsHeaders)
      } else {
        rows.push(['podcast_rebuild_webhook_secret', trimmed])
        rows.push(['podcast_rebuild_webhook_secret_set', '1'])
      }
    }

    await setSettings(env, rows)

    const configured = (await getSetting(env, 'podcast_rebuild_webhook_secret_set', { defaultValue: null })) === '1'
    return jsonResponse({
      ok: true,
      webhookUrl: webhookUrl ?? '',
      secretConfigured: configured,
    }, 200, corsHeaders)
  } catch (e) {
    console.error('handleRssPodcastWebhookConfig:', e)
    return jsonResponse({ error: 'Internal server error', code: 'internal_error' }, 500, corsHeaders)
  }
}

export async function handleRssPodcastPreviewRebuildNotify(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  try {
    const db = getDb(env)
    await ensureAdminSettingsTable(db)

    const freePreviewEnabled = String(await getSetting(env, 'rss_free_preview_enabled', { defaultValue: '1' }) ?? '1') === '1'
    if (!freePreviewEnabled) {
      return jsonResponse({ error: 'Free podcast preview feed is disabled', code: 'free_preview_disabled' }, 400, corsHeaders)
    }

    const body = await request.json().catch(() => ({}))
    const filterIds = Array.isArray(body?.videoIds)
      ? body.videoIds.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      : null

    let videos = await listPublishedVideosForRebuild(db)
    if (filterIds && filterIds.length) {
      const set = new Set(filterIds)
      videos = videos.filter((v: { id?: string }) => v?.id && set.has(v.id))
    }

    const result = await deliverPodcastPreviewRebuildWebhook(env, videos)
    if (!result.delivered) {
      if (result.code === 'webhook_not_configured') {
        return jsonResponse({ error: 'Podcast rebuild webhook URL is not configured', code: result.code }, 400, corsHeaders)
      }
      if (result.code === 'secret_not_configured') {
        return jsonResponse({ error: 'Podcast rebuild webhook secret is not configured', code: result.code }, 400, corsHeaders)
      }
      if (result.code === 'nothing_to_rebuild') {
        return jsonResponse({
          ok: true,
          delivered: false,
          code: result.code,
          videoCount: result.videoCount,
          skippedFullUnlockCount: result.skippedFullUnlockCount,
          message: 'No videos need a trimmed preview MP3 (premium-only or full unlock).',
        }, 200, corsHeaders)
      }
      return jsonResponse({
        error: result.code === 'webhook_timeout' ? 'Webhook request timed out' : 'Webhook request failed',
        code: result.code,
        status: result.webhookStatus,
        detail: result.detail,
      }, 502, corsHeaders)
    }

    return jsonResponse({
      ok: true,
      delivered: true,
      videoCount: result.eligibleCount,
      skippedFullUnlockCount: result.skippedFullUnlockCount,
      webhookStatus: result.webhookStatus,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      rejected: result.rejected,
    }, 200, corsHeaders)
  } catch (e) {
    console.error('handleRssPodcastPreviewRebuildNotify:', e)
    return jsonResponse({ error: 'Internal server error', code: 'internal_error' }, 500, corsHeaders)
  }
}