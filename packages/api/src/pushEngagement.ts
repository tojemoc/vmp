/**
 * Push notification engagement: campaigns, deliveries, clicks, watch sessions, tier scoring.
 */

import { requireRole } from './auth.js'
import { getSetting, setSettings } from './settingsStore.js'
import { sendPushNotification } from './webpush.js'

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function getDb(env: any) {
  return env.video_subscription_db || env.DB
}

function stripTrailingSlashes(value: string) {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

function normalizeFrontendBaseUrl(raw: unknown) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = stripTrailingSlashes(trimmed)
  return value || null
}

async function hashIp(ip: string) {
  const data = new TextEncoder().encode(ip)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function checkPushEventRateLimit(env: any, ipHash: string) {
  if (!env.RATE_LIMIT_KV || !ipHash) return true
  const key = `push-event:${ipHash}`
  const existing = await env.RATE_LIMIT_KV.get(key)
  if (existing) return false
  await env.RATE_LIMIT_KV.put(key, '1', { expirationTtl: 60 })
  return true
}

export async function isPushTierDeliveryEnabled(env: any) {
  const raw = await getSetting(env, 'push_tier_delivery_enabled', { defaultValue: '0' })
  return String(raw ?? '0') === '1'
}

export async function getPushTierSettings(env: any) {
  const [
    immediateMax,
    fastMax,
    slowMax,
    immediateDelay,
    fastDelay,
    slowDelay,
    dormantDelay,
    dormantSkip,
    maxDelayHours,
    minCampaigns,
    dormantCampaigns,
  ] = await Promise.all([
    getSetting(env, 'push_tier_immediate_max_seconds', { defaultValue: '900' }),
    getSetting(env, 'push_tier_fast_max_seconds', { defaultValue: '3600' }),
    getSetting(env, 'push_tier_slow_max_seconds', { defaultValue: '14400' }),
    getSetting(env, 'push_tier_immediate_delay_seconds', { defaultValue: '0' }),
    getSetting(env, 'push_tier_fast_delay_seconds', { defaultValue: '1800' }),
    getSetting(env, 'push_tier_slow_delay_seconds', { defaultValue: '7200' }),
    getSetting(env, 'push_tier_dormant_delay_seconds', { defaultValue: '21600' }),
    getSetting(env, 'push_tier_dormant_skip', { defaultValue: '0' }),
    getSetting(env, 'push_tier_max_delay_hours', { defaultValue: '6' }),
    getSetting(env, 'push_tier_min_campaigns_unknown', { defaultValue: '2' }),
    getSetting(env, 'push_tier_dormant_campaigns', { defaultValue: '3' }),
  ])
  return {
    immediateMaxSeconds: Number.parseInt(String(immediateMax), 10) || 900,
    fastMaxSeconds: Number.parseInt(String(fastMax), 10) || 3600,
    slowMaxSeconds: Number.parseInt(String(slowMax), 10) || 14400,
    immediateDelaySeconds: Number.parseInt(String(immediateDelay), 10) || 0,
    fastDelaySeconds: Number.parseInt(String(fastDelay), 10) || 1800,
    slowDelaySeconds: Number.parseInt(String(slowDelay), 10) || 7200,
    dormantDelaySeconds: Number.parseInt(String(dormantDelay), 10) || 21600,
    dormantSkip: String(dormantSkip) === '1',
    maxDelayHours: Number.parseInt(String(maxDelayHours), 10) || 6,
    minCampaignsUnknown: Number.parseInt(String(minCampaigns), 10) || 2,
    dormantCampaigns: Number.parseInt(String(dormantCampaigns), 10) || 3,
  }
}

export function tierDelaySeconds(tier: string, settings: Awaited<ReturnType<typeof getPushTierSettings>>) {
  if (tier === 'immediate') return settings.immediateDelaySeconds
  if (tier === 'fast') return settings.fastDelaySeconds
  if (tier === 'slow') return settings.slowDelaySeconds
  if (tier === 'dormant') return settings.dormantSkip ? -1 : settings.dormantDelaySeconds
  return settings.immediateDelaySeconds
}

export async function handlePushEvents(request: Request, env: any, corsHeaders: Record<string, string>) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || ''
  const ipHash = ip ? await hashIp(ip.split(',')[0].trim()) : ''
  if (!(await checkPushEventRateLimit(env, ipHash))) {
    return jsonResponse({ error: 'Rate limit exceeded', code: 'rate_limit' }, 429, corsHeaders)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body', code: 'invalid_json' }, 400, corsHeaders)
  }

  const eventType = typeof body?.type === 'string' ? body.type : ''
  const deliveryId = typeof body?.deliveryId === 'string' ? body.deliveryId.trim() : ''
  if (!deliveryId) {
    return jsonResponse({ error: 'deliveryId is required', code: 'invalid_payload' }, 400, corsHeaders)
  }

  const db = getDb(env)
  if (eventType === 'click') {
    const delivery = await db.prepare(`
      SELECT id, campaign_id, user_id, sent_at, status
      FROM push_deliveries
      WHERE id = ?
    `).bind(deliveryId).first()
    if (!delivery || delivery.status !== 'sent' || !delivery.sent_at) {
      return jsonResponse({ error: 'Delivery not found or not sent', code: 'not_found' }, 404, corsHeaders)
    }
    const existing = await db.prepare(`SELECT id FROM push_clicks WHERE delivery_id = ?`).bind(deliveryId).first()
    if (existing) {
      return jsonResponse({ ok: true, duplicate: true }, 200, corsHeaders)
    }
    const clickedAt = new Date().toISOString()
    const sentMs = Date.parse(String(delivery.sent_at))
    const clickLatencySeconds = Number.isFinite(sentMs)
      ? Math.max(0, Math.floor((Date.now() - sentMs) / 1000))
      : null
    await db.prepare(`
      INSERT INTO push_clicks (id, delivery_id, campaign_id, user_id, clicked_at, click_latency_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), deliveryId, delivery.campaign_id, delivery.user_id, clickedAt, clickLatencySeconds).run()
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  if (eventType === 'session_start') {
    const delivery = await db.prepare(`
      SELECT id, campaign_id, user_id, status
      FROM push_deliveries
      WHERE id = ?
    `).bind(deliveryId).first()
    if (!delivery || delivery.status !== 'sent') {
      return jsonResponse({ error: 'Delivery not found or not sent', code: 'not_found' }, 404, corsHeaders)
    }
    const originVideoId = typeof body?.originVideoId === 'string' ? body.originVideoId.trim() : ''
    if (!originVideoId) {
      return jsonResponse({ error: 'originVideoId is required', code: 'invalid_payload' }, 400, corsHeaders)
    }
    const existing = await db.prepare(`
      SELECT id FROM push_watch_sessions WHERE delivery_id = ? LIMIT 1
    `).bind(deliveryId).first()
    if (existing) {
      return jsonResponse({ ok: true, sessionId: existing.id, duplicate: true }, 200, corsHeaders)
    }
    const sessionId = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO push_watch_sessions (
        id, campaign_id, delivery_id, user_id, origin_video_id, started_at, videos_watched_count
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
    `).bind(sessionId, delivery.campaign_id, deliveryId, delivery.user_id, originVideoId).run()
    return jsonResponse({ ok: true, sessionId }, 200, corsHeaders)
  }

  if (eventType === 'session_end') {
    const session = await db.prepare(`
      SELECT id, started_at FROM push_watch_sessions WHERE delivery_id = ? LIMIT 1
    `).bind(deliveryId).first()
    if (!session) {
      return jsonResponse({ error: 'Session not found', code: 'not_found' }, 404, corsHeaders)
    }
    const originMaxRetention = Number(body?.originMaxRetentionPercent)
    const videosWatchedCount = Number.parseInt(String(body?.videosWatchedCount ?? 1), 10)
    const otherVideos = Array.isArray(body?.otherVideosWatched)
      ? body.otherVideosWatched.filter((v: unknown) => typeof v === 'string')
      : []
    const sessionDurationSeconds = Number.parseInt(String(body?.sessionDurationSeconds ?? 0), 10)
    let outcome = 'partial'
    if (Number.isFinite(originMaxRetention)) {
      if (originMaxRetention < 10) outcome = 'bounced'
      else if (originMaxRetention >= 90) outcome = 'completed'
      else if (videosWatchedCount > 1) outcome = 'explored'
    }
    await db.prepare(`
      UPDATE push_watch_sessions
      SET ended_at = CURRENT_TIMESTAMP,
          session_duration_seconds = ?,
          origin_max_retention_percent = ?,
          videos_watched_count = ?,
          other_videos_watched = ?,
          outcome = ?
      WHERE id = ?
        AND ended_at IS NULL
    `).bind(
      Number.isFinite(sessionDurationSeconds) ? sessionDurationSeconds : null,
      Number.isFinite(originMaxRetention) ? Math.min(100, Math.max(0, originMaxRetention)) : null,
      Number.isFinite(videosWatchedCount) && videosWatchedCount > 0 ? videosWatchedCount : 1,
      otherVideos.length ? JSON.stringify(otherVideos) : null,
      outcome,
      session.id,
    ).run()
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'Unsupported event type', code: 'invalid_payload' }, 400, corsHeaders)
}

export async function handleAdminPushAnalytics(request: Request, env: any, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const url = new URL(request.url)
  const campaignId = url.searchParams.get('campaignId')?.trim()
  if (!campaignId) {
    return jsonResponse({ error: 'campaignId is required', code: 'invalid_query' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const campaign = await db.prepare(`
    SELECT id, video_id, mode, started_at, completed_at
    FROM push_campaigns WHERE id = ?
  `).bind(campaignId).first()
  if (!campaign) {
    return jsonResponse({ error: 'Campaign not found' }, 404, corsHeaders)
  }

  const [sentRow, clickRow, latencyRow, watchRow, completionRow, depthRow] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM push_deliveries WHERE campaign_id = ? AND status = 'sent'`).bind(campaignId).first(),
    db.prepare(`SELECT COUNT(*) AS count FROM push_clicks WHERE campaign_id = ?`).bind(campaignId).first(),
    db.prepare(`
      SELECT AVG(click_latency_seconds) AS median_latency
      FROM (
        SELECT click_latency_seconds
        FROM push_clicks
        WHERE campaign_id = ? AND click_latency_seconds IS NOT NULL
        ORDER BY click_latency_seconds
        LIMIT 9999
      )
    `).bind(campaignId).first(),
    db.prepare(`SELECT COUNT(*) AS count FROM push_watch_sessions WHERE campaign_id = ?`).bind(campaignId).first(),
    db.prepare(`
      SELECT COUNT(*) AS count FROM push_watch_sessions
      WHERE campaign_id = ? AND origin_max_retention_percent >= 90
    `).bind(campaignId).first(),
    db.prepare(`
      SELECT AVG(videos_watched_count) AS avg_depth FROM push_watch_sessions WHERE campaign_id = ?
    `).bind(campaignId).first(),
  ])

  const sent = Number(sentRow?.count || 0)
  const clicks = Number(clickRow?.count || 0)
  const watchSessions = Number(watchRow?.count || 0)
  const completions = Number(completionRow?.count || 0)

  return jsonResponse({
    campaign,
    funnel: {
      sent,
      clicks,
      clickRatePercent: sent > 0 ? Number(((clicks / sent) * 100).toFixed(2)) : 0,
      medianClickLatencySeconds: latencyRow?.median_latency != null
        ? Number(Number(latencyRow.median_latency).toFixed(0))
        : null,
      watchSessions,
      watchRatePercent: clicks > 0 ? Number(((watchSessions / clicks) * 100).toFixed(2)) : 0,
      completionRatePercent: watchSessions > 0 ? Number(((completions / watchSessions) * 100).toFixed(2)) : 0,
      avgSessionDepth: depthRow?.avg_depth != null ? Number(Number(depthRow.avg_depth).toFixed(2)) : 0,
    },
  }, 200, corsHeaders)
}

function normalizeApiBaseUrl(env: any) {
  const explicitRaw = typeof env.API_PUBLIC_URL === 'string' ? env.API_PUBLIC_URL.trim() : ''
  const explicit = explicitRaw ? stripTrailingSlashes(explicitRaw) : ''
  if (explicit) return explicit
  const frontend = typeof env.FRONTEND_URL === 'string' ? env.FRONTEND_URL.trim() : ''
  if (frontend.includes('localhost')) return 'http://localhost:8787'
  return 'https://vmp-api.tjm.sk'
}

export async function buildPushPayload(env: any, videoTitle: string, videoId: string, deliveryId: string, campaignId: string) {
  const frontendBaseUrl = normalizeFrontendBaseUrl(env.FRONTEND_URL)
  const apiBaseUrl = normalizeApiBaseUrl(env)
  const watchPath = `/watch/${encodeURIComponent(String(videoId))}`
  const query = new URLSearchParams({
    nid: deliveryId,
    utm_source: 'push',
    utm_medium: 'notification',
  })
  const url = frontendBaseUrl
    ? `${frontendBaseUrl}${watchPath}?${query.toString()}`
    : `${watchPath}?${query.toString()}`
  return {
    title: 'New video published',
    body: videoTitle,
    url,
    type: 'new_video',
    deliveryId,
    campaignId,
    eventsUrl: `${apiBaseUrl}/api/push/events`,
  }
}

export async function executePushDelivery(deliveryId: string, env: any, db: any) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
    throw Object.assign(new Error('VAPID keys not configured'), { code: 'vapid_not_configured' })
  }

  const delivery = await db.prepare(`
    SELECT d.id, d.status, d.campaign_id, d.user_id, d.subscription_id,
           s.endpoint, s.p256dh, s.auth,
           c.video_id, v.title AS video_title
    FROM push_deliveries d
    INNER JOIN push_subscriptions s ON s.id = d.subscription_id
    INNER JOIN push_campaigns c ON c.id = d.campaign_id
    INNER JOIN videos v ON v.id = c.video_id
    WHERE d.id = ?
  `).bind(deliveryId).first()

  if (!delivery) return { skipped: true, reason: 'not_found' }
  if (delivery.status !== 'pending') return { skipped: true, reason: 'not_pending' }

  const payload = await buildPushPayload(
    env,
    delivery.video_title || delivery.video_id,
    delivery.video_id,
    delivery.id,
    delivery.campaign_id,
  )

  try {
    await sendPushNotification(
      { endpoint: delivery.endpoint, p256dh: delivery.p256dh, auth: delivery.auth },
      payload,
      env,
    )
    await db.prepare(`
      UPDATE push_deliveries
      SET status = 'sent', sent_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).bind(deliveryId).run()
    return { ok: true, deliveryId }
  } catch (err: any) {
    if (err?.code === 'subscription_gone') {
      await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(delivery.endpoint).run()
      await db.prepare(`
        UPDATE push_deliveries SET status = 'failed' WHERE id = ? AND status = 'pending'
      `).bind(deliveryId).run()
      return { failed: true, reason: 'subscription_gone', deliveryId }
    }
    throw err
  }
}

export async function enqueuePushDelivery(env: any, deliveryId: string, delaySeconds: number) {
  if (!env.PUSH_DELIVERY_QUEUE) return false
  const capped = Math.max(0, Math.min(86400, Math.floor(delaySeconds)))
  await env.PUSH_DELIVERY_QUEUE.send({ deliveryId }, { delaySeconds: capped })
  return true
}

export async function enqueueOverduePushDeliveries(env: any) {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, delay_seconds, scheduled_at
    FROM push_deliveries
    WHERE status = 'pending'
      AND datetime(scheduled_at) <= datetime('now')
    ORDER BY scheduled_at ASC
    LIMIT 100
  `).all()
  const deliveries = rows?.results ?? []
  if (!deliveries.length) return 0

  let enqueued = 0
  for (const row of deliveries as any[]) {
    if (env.PUSH_DELIVERY_QUEUE) {
      const scheduledMs = Date.parse(String(row.scheduled_at))
      const delaySeconds = Number.isFinite(scheduledMs)
        ? Math.max(0, Math.min(86400, Math.floor((Date.now() - scheduledMs) / 1000)))
        : 0
      await enqueuePushDelivery(env, row.id, delaySeconds)
      enqueued++
    } else {
      await executePushDelivery(row.id, env, db)
      enqueued++
    }
  }
  return enqueued
}

export async function handlePushDeliveryQueue(batch: any, env: any) {
  const db = getDb(env)
  for (const message of batch.messages) {
    const deliveryId = message?.body?.deliveryId
    if (typeof deliveryId !== 'string' || !deliveryId.trim()) {
      message.ack()
      continue
    }
    try {
      await executePushDelivery(deliveryId.trim(), env, db)
      message.ack()
    } catch (err) {
      console.error('Push delivery queue error:', err)
      message.retry({ delaySeconds: 300 })
    }
  }
}

export async function createPushCampaignAndDeliveries(options: {
  env: any
  db: any
  videoId: string
  videoTitle: string
  createdByUserId: string | null
  tiered: boolean
}) {
  const { env, db, videoId, videoTitle, createdByUserId, tiered } = options
  const campaignId = crypto.randomUUID()
  const mode = tiered ? 'tiered' : 'immediate'
  const tierSettings = await getPushTierSettings(env)
  const maxDelaySeconds = tierSettings.maxDelayHours * 3600

  await db.prepare(`
    INSERT INTO push_campaigns (id, video_id, created_by_user_id, mode, started_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(campaignId, videoId, createdByUserId, mode).run()

  const subs = await db.prepare(`
    SELECT ps.id AS subscription_id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth,
           COALESCE(pep.tier, 'unknown') AS tier
    FROM push_subscriptions ps
    LEFT JOIN push_engagement_profiles pep ON pep.user_id = ps.user_id
  `).all()
  const subscriptions = subs?.results ?? []

  const tierCounts: Record<string, number> = {}
  let scheduled = 0
  let skipped = 0
  const now = Date.now()

  for (const sub of subscriptions as any[]) {
    let delaySeconds = 0
    if (tiered) {
      delaySeconds = tierDelaySeconds(String(sub.tier || 'unknown'), tierSettings)
      if (delaySeconds < 0) {
        skipped++
        continue
      }
      delaySeconds = Math.min(delaySeconds, maxDelaySeconds)
    }

    const deliveryId = crypto.randomUUID()
    const scheduledAt = new Date(now + delaySeconds * 1000).toISOString()
    await db.prepare(`
      INSERT INTO push_deliveries (
        id, campaign_id, user_id, subscription_id, scheduled_at, delay_seconds, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).bind(deliveryId, campaignId, sub.user_id, sub.subscription_id, scheduledAt, delaySeconds).run()

    const tierKey = tiered ? String(sub.tier || 'unknown') : 'immediate'
    tierCounts[tierKey] = (tierCounts[tierKey] || 0) + 1
    scheduled++

    if (env.PUSH_DELIVERY_QUEUE) {
      await enqueuePushDelivery(env, deliveryId, delaySeconds)
    }
  }

  if (!env.PUSH_DELIVERY_QUEUE && scheduled > 0) {
    const pending = await db.prepare(`
      SELECT id FROM push_deliveries WHERE campaign_id = ? AND status = 'pending'
    `).bind(campaignId).all()
    for (const row of (pending?.results ?? []) as any[]) {
      await executePushDelivery(row.id, env, db)
    }
  }

  return {
    campaignId,
    mode,
    scheduled,
    skipped,
    tiers: tierCounts,
    videoTitle,
  }
}

function assignTierFromMedianLatency(medianSeconds: number | null, settings: Awaited<ReturnType<typeof getPushTierSettings>>) {
  if (medianSeconds == null) return 'dormant'
  if (medianSeconds <= settings.immediateMaxSeconds) return 'immediate'
  if (medianSeconds <= settings.fastMaxSeconds) return 'fast'
  if (medianSeconds <= settings.slowMaxSeconds) return 'slow'
  return 'dormant'
}

export async function syncPushEngagementProfiles(env: any) {
  const db = getDb(env)
  const settings = await getPushTierSettings(env)

  const users = await db.prepare(`
    SELECT DISTINCT user_id FROM push_deliveries WHERE status = 'sent'
  `).all()
  const userIds = (users?.results ?? []).map((r: any) => r.user_id).filter(Boolean)
  if (!userIds.length) return 0

  let updated = 0
  for (const userId of userIds) {
    const clickStats = await db.prepare(`
      SELECT click_latency_seconds
      FROM push_clicks
      WHERE user_id = ?
        AND click_latency_seconds IS NOT NULL
      ORDER BY clicked_at DESC
      LIMIT 10
    `).bind(userId).all()
    const latencies = (clickStats?.results ?? [])
      .map((r: any) => Number(r.click_latency_seconds))
      .filter((n: number) => Number.isFinite(n))
      .sort((a: number, b: number) => a - b)

    const campaignsObserved = Number((await db.prepare(`
      SELECT COUNT(DISTINCT campaign_id) AS count
      FROM push_deliveries
      WHERE user_id = ? AND status = 'sent'
    `).bind(userId).first())?.count || 0)

    let medianClickLatency: number | null = null
    if (latencies.length) {
      const mid = Math.floor(latencies.length / 2)
      medianClickLatency = latencies.length % 2 === 0
        ? Math.round((latencies[mid - 1] + latencies[mid]) / 2)
        : latencies[mid]
    }

    const sessionStats = await db.prepare(`
      SELECT AVG(videos_watched_count) AS avg_depth,
             AVG(origin_max_retention_percent) AS avg_retention
      FROM push_watch_sessions
      WHERE user_id = ?
        AND ended_at IS NOT NULL
    `).bind(userId).first()

    let tier = 'unknown'
    if (campaignsObserved >= settings.minCampaignsUnknown && latencies.length === 0 && campaignsObserved >= settings.dormantCampaigns) {
      tier = 'dormant'
    } else if (campaignsObserved >= settings.minCampaignsUnknown && latencies.length > 0) {
      tier = assignTierFromMedianLatency(medianClickLatency, settings)
    }

    await db.prepare(`
      INSERT INTO push_engagement_profiles (
        user_id, median_click_latency_seconds, tier, avg_session_depth,
        avg_origin_retention_percent, campaigns_observed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        median_click_latency_seconds = excluded.median_click_latency_seconds,
        tier = excluded.tier,
        avg_session_depth = excluded.avg_session_depth,
        avg_origin_retention_percent = excluded.avg_origin_retention_percent,
        campaigns_observed = excluded.campaigns_observed,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      userId,
      medianClickLatency,
      tier,
      sessionStats?.avg_depth != null ? Number(sessionStats.avg_depth) : null,
      sessionStats?.avg_retention != null ? Number(sessionStats.avg_retention) : null,
      campaignsObserved,
    ).run()
    updated++
  }
  return updated
}

export async function finalizeStalePushWatchSessions(env: any) {
  const db = getDb(env)
  const result = await db.prepare(`
    UPDATE push_watch_sessions
    SET ended_at = CURRENT_TIMESTAMP,
        outcome = COALESCE(outcome, 'partial')
    WHERE ended_at IS NULL
      AND datetime(started_at) <= datetime('now', '-24 hours')
  `).run()
  return Number(result.meta?.changes ?? result.changes ?? 0)
}

export async function ensurePushTierDefaultSettings(env: any) {
  const defaults: [string, string][] = [
    ['push_tier_delivery_enabled', '0'],
    ['push_tier_immediate_max_seconds', '900'],
    ['push_tier_fast_max_seconds', '3600'],
    ['push_tier_slow_max_seconds', '14400'],
    ['push_tier_immediate_delay_seconds', '0'],
    ['push_tier_fast_delay_seconds', '1800'],
    ['push_tier_slow_delay_seconds', '7200'],
    ['push_tier_dormant_delay_seconds', '21600'],
    ['push_tier_dormant_skip', '0'],
    ['push_tier_max_delay_hours', '6'],
    ['push_tier_min_campaigns_unknown', '2'],
    ['push_tier_dormant_campaigns', '3'],
  ]
  const missing: [string, string][] = []
  for (const [key, value] of defaults) {
    const existing = await getSetting(env, key)
    if (existing == null || existing === '') missing.push([key, value])
  }
  if (missing.length) await setSettings(env, missing)
}
