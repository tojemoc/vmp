/**
 * Watch-page recommendation scoring using per-category admin tuning.
 */

import { getDb } from './d1Session.js'

type RecommendationVideo = {
  id: string
  slug?: string | null
  title: string
  description?: string | null
  thumbnail_url?: string | null
  full_duration?: number
  preview_duration?: number
  category_id?: string | null
  published_at?: string | null
  upload_date?: string | null
  view_count?: number
}

type CategoryRecommendationSettings = {
  recencyBias: number
  lowViewsBoost: number
  categoryLock: boolean
}

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function parseTimestamp(value: unknown): number {
  if (value == null || value === '') return 0
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? ms : 0
}

function normalizeSettings(row: Record<string, unknown> | null | undefined): CategoryRecommendationSettings {
  const recency = Number(row?.recommendation_recency_bias)
  const boost = Number(row?.recommendation_low_views_boost)
  return {
    recencyBias: Number.isFinite(recency) ? Math.max(0, recency) : 1,
    lowViewsBoost: Number.isFinite(boost) ? Math.max(0, boost) : 0,
    categoryLock: Number(row?.recommendation_category_lock) === 1,
  }
}

export function mapRecommendationVideoRow(row: Record<string, unknown>): RecommendationVideo {
  return {
    id: String(row.id ?? ''),
    slug: row.slug != null ? String(row.slug) : null,
    title: String(row.title ?? ''),
    description: row.description != null ? String(row.description) : null,
    thumbnail_url: row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    full_duration: Number(row.full_duration) || 0,
    preview_duration: Number(row.preview_duration) || 0,
    category_id: row.category_id != null ? String(row.category_id) : null,
    published_at: row.published_at != null ? String(row.published_at) : null,
    upload_date: row.upload_date != null ? String(row.upload_date) : null,
    view_count: Number(row.view_count) || 0,
  }
}

export function scoreRecommendationVideos(
  videos: RecommendationVideo[],
  currentVideoId: string,
  settings: CategoryRecommendationSettings,
): RecommendationVideo[] {
  const candidates = videos.filter((v) => v.id !== currentVideoId)
  if (candidates.length === 0) return []

  const current = videos.find((v) => v.id === currentVideoId)
  const currentCategory =
    typeof current?.category_id === 'string' ? current.category_id.trim() : ''

  const filtered = settings.categoryLock && currentCategory
    ? candidates.filter((v) => String(v.category_id ?? '').trim() === currentCategory)
    : candidates

  if (filtered.length === 0) return []

  const viewCounts = filtered.map((v) => Math.max(0, Number(v.view_count) || 0))
  const maxViews = Math.max(1, ...viewCounts)
  const minViews = Math.min(...viewCounts)
  const viewSpread = Math.max(1, maxViews - minViews)

  const timestamps = filtered.map((v) =>
    parseTimestamp(v.published_at) || parseTimestamp(v.upload_date),
  )
  const maxTs = Math.max(...timestamps, 1)
  const minTs = Math.min(...timestamps.filter((t) => t > 0), maxTs)

  const scored = filtered.map((video, index) => {
    const ts = timestamps[index] ?? 0
    const recencyScore = maxTs > minTs ? (ts - minTs) / (maxTs - minTs) : 0.5
    const views = viewCounts[index] ?? 0
    const lowViewScore = settings.lowViewsBoost > 0
      ? (maxViews - views) / viewSpread
      : 0
    const sameCategoryBonus =
      currentCategory && String(video.category_id ?? '').trim() === currentCategory ? 0.15 : 0

    const score =
      settings.recencyBias * recencyScore +
      settings.lowViewsBoost * lowViewScore +
      sameCategoryBonus

    return { video, score }
  })

  scored.sort((a, b) => b.score - a.score || b.video.id.localeCompare(a.video.id))
  return scored.map((row) => row.video)
}

export async function handleVideoRecommendations(request: Request, env: any, corsHeaders: Record<string, string>) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const url = new URL(request.url)
  const videoId = String(url.searchParams.get('videoId') ?? '').trim()
  const limitRaw = Number(url.searchParams.get('limit') ?? 5)
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 5

  if (!videoId) {
    return jsonResponse({ error: 'videoId is required' }, 400, corsHeaders)
  }

  try {
    const db = getDb(env)
    const current = await db.prepare(`
      SELECT v.id, v.slug, v.published_at, v.upload_date, vca.category_id
      FROM videos v
      LEFT JOIN video_category_assignments vca ON vca.video_id = v.id
      WHERE v.id = ? OR v.slug = ?
      LIMIT 1
    `).bind(videoId, videoId).first()

    if (!current) {
      return jsonResponse({ error: 'Video not found' }, 404, corsHeaders)
    }

    const categoryId = String((current as any).category_id ?? '').trim()
    let settings: CategoryRecommendationSettings = {
      recencyBias: 1,
      lowViewsBoost: 0,
      categoryLock: false,
    }

    if (categoryId) {
      const categoryRow = await db.prepare(`
        SELECT recommendation_recency_bias, recommendation_low_views_boost, recommendation_category_lock
        FROM video_categories WHERE id = ?
      `).bind(categoryId).first()
      settings = normalizeSettings(categoryRow as Record<string, unknown> | null)
    }

    // view_count from video_view_counts (incremental updates in logSegmentEvent — adminExtras.ts; backfill migration 0030).
    const list = await db.prepare(`
      SELECT v.id, v.slug, v.title, v.description, v.thumbnail_url,
             v.full_duration, v.preview_duration,
             v.published_at, v.upload_date, vca.category_id,
             COALESCE(vvc.view_count, 0) AS view_count
      FROM videos v
      LEFT JOIN video_category_assignments vca ON vca.video_id = v.id
      LEFT JOIN video_view_counts vvc ON vvc.video_id = v.id
      WHERE v.publish_status = 'published'
        AND (v.scheduled_publish_at IS NULL OR datetime(v.scheduled_publish_at) <= CURRENT_TIMESTAMP)
    `).all()

    const ranked = scoreRecommendationVideos(
      (list.results ?? []).map((row: Record<string, unknown>) => mapRecommendationVideoRow(row)),
      String((current as any).id),
      settings,
    )

    return jsonResponse({ videos: ranked.slice(0, limit) }, 200, corsHeaders)
  } catch (err) {
    console.error('handleVideoRecommendations error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}
