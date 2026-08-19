/**
 * Auth-gated last-playback-position store for VOD resume (#488).
 *
 * GET  /api/account/playback-positions
 * GET  /api/account/playback-positions/:videoId
 * PUT  /api/account/playback-positions/:videoId
 *      { positionSeconds, durationSeconds?, force?, capturedAtMs? }
 * DELETE /api/account/playback-positions/:videoId
 *
 * Writes are intentionally cheap to spam: server enforces a short cooldown per
 * user/video unless the client marks the write as a flush (navigate-away / next video).
 * Stale writes (older capturedAtMs than the stored row) are rejected unless the stored
 * row has a clock-skewed timestamp far in the future.
 */

import {
  isNearPlaybackEnd,
  normalizeClientCapturedAtMs,
  PLAYBACK_POSITION_MIN_SAVE_SECONDS,
  shouldRejectStalePlaybackWrite,
} from '@vmp/shared';
import { requireAuth, requireRole } from './auth.js';

export {
  getPlaybackEndClearThresholds,
  getPlaybackSaveIntervalMs,
  isNearPlaybackEnd,
  normalizeClientCapturedAtMs,
  PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS,
  PLAYBACK_POSITION_END_EPSILON_MIN_FRACTION,
  PLAYBACK_POSITION_END_FRACTION_LONG,
  PLAYBACK_POSITION_MAX_CLOCK_SKEW_MS,
  PLAYBACK_POSITION_MIN_SAVE_SECONDS,
  PLAYBACK_POSITION_SAVE_INTERVAL_MAX_MS,
  PLAYBACK_POSITION_SAVE_INTERVAL_MIN_MS,
  PLAYBACK_POSITION_SHORT_FORM_MAX_SECONDS,
  shouldRejectStalePlaybackWrite,
} from '@vmp/shared';

/** Minimum interval between non-flush upserts for the same user/video. */
export const PLAYBACK_POSITION_MIN_WRITE_INTERVAL_MS = 5000;

/** @deprecated Use PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS from @vmp/shared */
export const PLAYBACK_POSITION_END_EPSILON_SECONDS = 30;

/** @deprecated Use PLAYBACK_POSITION_END_FRACTION_LONG from @vmp/shared */
export const PLAYBACK_POSITION_END_FRACTION = 0.95;

type CorsHeaders = Record<string, string>;

function jsonResponse(data: unknown, status = 200, corsHeaders: CorsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getDb(env: any) {
  return env.DB || env.video_subscription_db;
}

async function resolveVideoId(db: any, idOrSlug: string): Promise<string | null> {
  const byId = await db.prepare('SELECT id FROM videos WHERE id = ?').bind(idOrSlug).first();
  if (byId?.id) return String(byId.id);
  const bySlug = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(idOrSlug).first();
  if (bySlug?.id) return String(bySlug.id);
  const byLegacy = await db
    .prepare('SELECT id FROM videos WHERE legacy_slug = ?')
    .bind(idOrSlug)
    .first();
  return byLegacy?.id ? String(byLegacy.id) : null;
}

export function normalizePositionSeconds(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  }
  return null;
}

export function normalizeOptionalDurationSeconds(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const value = normalizePositionSeconds(raw);
  if (value == null || value <= 0) return null;
  return value;
}

export function normalizeCapturedAtMs(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.floor(raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
  }
  return null;
}

/**
 * Decide whether a position should be cleared (finished / too early) instead of saved.
 * Returns 'clear' | 'save' | 'ignore'.
 */
export function classifyPlaybackPosition(
  positionSeconds: number,
  durationSeconds: number | null,
): 'clear' | 'save' | 'ignore' {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return 'ignore';
  if (positionSeconds < PLAYBACK_POSITION_MIN_SAVE_SECONDS) return 'clear';

  if (durationSeconds != null && durationSeconds > 0) {
    if (isNearPlaybackEnd(positionSeconds, durationSeconds)) return 'clear';
    if (positionSeconds > durationSeconds + 1) return 'ignore';
  }

  return 'save';
}

export function shouldThrottlePlaybackWrite(opts: {
  lastUpdatedAt: string | null | undefined;
  nowMs?: number;
  force?: boolean;
}): boolean {
  if (opts.force) return false;
  if (!opts.lastUpdatedAt) return false;
  const lastMs = Date.parse(opts.lastUpdatedAt);
  if (!Number.isFinite(lastMs)) return false;
  const nowMs = opts.nowMs ?? Date.now();
  return nowMs - lastMs < PLAYBACK_POSITION_MIN_WRITE_INTERVAL_MS;
}

function parseVideoIdParam(raw: string | undefined): string | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const trimmed = decoded.trim();
  if (!trimmed || trimmed.includes('/') || trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

export async function clearPlaybackPositionsForVideo(db: any, videoId: string): Promise<number> {
  const result = await db
    .prepare('DELETE FROM playback_positions WHERE video_id = ?')
    .bind(videoId)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export async function handleListPlaybackPositions(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const db = getDb(env);
  if (!db) return jsonResponse({ error: 'Database not configured' }, 503, corsHeaders);

  const TARGET_ITEMS = 20;
  const BATCH_SIZE = 60;
  const items: Array<{
    videoId: string;
    title: string;
    slug: string | null;
    thumbnailUrl: string | null;
    positionSeconds: number;
    durationSeconds: number | null;
    updatedAt: string | null;
    watchPath: string;
    progressPercent: number | null;
  }> = [];
  let lastUpdatedAt: string | null = null;

  while (items.length < TARGET_ITEMS) {
    const offsetClause = lastUpdatedAt
      ? `AND pp.updated_at < ?`
      : '';
    const binds = lastUpdatedAt
      ? [user.sub, PLAYBACK_POSITION_MIN_SAVE_SECONDS, lastUpdatedAt, BATCH_SIZE]
      : [user.sub, PLAYBACK_POSITION_MIN_SAVE_SECONDS, BATCH_SIZE];

    const rows = await db
      .prepare(
        `SELECT pp.video_id, pp.position_seconds, pp.updated_at,
                v.title, v.slug, v.thumbnail_url, v.full_duration
         FROM playback_positions pp
         INNER JOIN videos v ON v.id = pp.video_id
         WHERE pp.user_id = ?
           AND v.publish_status = 'published'
           AND pp.position_seconds >= ?
           ${offsetClause}
         ORDER BY pp.updated_at DESC
         LIMIT ?`,
      )
      .bind(...binds)
      .all();

    const batch = rows.results ?? [];
    if (batch.length === 0) break;

    for (const row of batch as any[]) {
      lastUpdatedAt = row.updated_at ?? null;
      const positionSeconds = Number(row.position_seconds);
      const durationSeconds =
        Number(row.full_duration) > 0 ? Number(row.full_duration) : null;
      if (isNearPlaybackEnd(positionSeconds, durationSeconds)) continue;

      const watchSlug = row.slug ? String(row.slug) : String(row.video_id);
      items.push({
        videoId: String(row.video_id),
        title: String(row.title ?? ''),
        slug: row.slug ? String(row.slug) : null,
        thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
        positionSeconds,
        durationSeconds,
        updatedAt: row.updated_at ?? null,
        watchPath: `/watch/${encodeURIComponent(watchSlug)}`,
        progressPercent:
          durationSeconds != null && durationSeconds > 0
            ? Math.min(100, Math.round((positionSeconds / durationSeconds) * 100))
            : null,
      });
      if (items.length >= TARGET_ITEMS) break;
    }

    if ((batch as any[]).length < BATCH_SIZE) break;
  }

  return jsonResponse({ items }, 200, corsHeaders);
}

export async function handleGetPlaybackPosition(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  videoIdParam: string,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const idOrSlug = parseVideoIdParam(videoIdParam);
  if (!idOrSlug) {
    return jsonResponse({ error: 'Invalid video id' }, 400, corsHeaders);
  }

  const db = getDb(env);
  if (!db) return jsonResponse({ error: 'Database not configured' }, 503, corsHeaders);

  const videoId = await resolveVideoId(db, idOrSlug);
  if (!videoId) return jsonResponse({ error: 'Video not found' }, 404, corsHeaders);

  const row = await db
    .prepare(
      `SELECT position_seconds, updated_at, client_captured_at_ms
       FROM playback_positions
       WHERE user_id = ? AND video_id = ?`,
    )
    .bind(user.sub, videoId)
    .first();

  if (!row) {
    return jsonResponse({ videoId, positionSeconds: null, updatedAt: null }, 200, corsHeaders);
  }

  return jsonResponse(
    {
      videoId,
      positionSeconds: Number(row.position_seconds),
      updatedAt: row.updated_at ?? null,
    },
    200,
    corsHeaders,
  );
}

export async function handleDeletePlaybackPosition(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  videoIdParam: string,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const idOrSlug = parseVideoIdParam(videoIdParam);
  if (!idOrSlug) {
    return jsonResponse({ error: 'Invalid video id' }, 400, corsHeaders);
  }

  const db = getDb(env);
  if (!db) return jsonResponse({ error: 'Database not configured' }, 503, corsHeaders);

  const videoId = await resolveVideoId(db, idOrSlug);
  if (!videoId) return jsonResponse({ error: 'Video not found' }, 404, corsHeaders);

  await db
    .prepare('DELETE FROM playback_positions WHERE user_id = ? AND video_id = ?')
    .bind(user.sub, videoId)
    .run();

  return jsonResponse({ videoId, deleted: true }, 200, corsHeaders);
}

export async function handleAdminClearPlaybackPositions(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  videoIdParam: string,
) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin');
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const videoId = parseVideoIdParam(videoIdParam);
  if (!videoId) {
    return jsonResponse({ error: 'Invalid video id' }, 400, corsHeaders);
  }

  const db = getDb(env);
  if (!db) return jsonResponse({ error: 'Database not configured' }, 503, corsHeaders);

  const existing = await db.prepare('SELECT id FROM videos WHERE id = ?').bind(videoId).first();
  if (!existing) {
    return jsonResponse({ error: 'Video not found' }, 404, corsHeaders);
  }

  const deletedCount = await clearPlaybackPositionsForVideo(db, videoId);
  return jsonResponse({ videoId, deletedCount }, 200, corsHeaders);
}

export async function handlePutPlaybackPosition(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  videoIdParam: string,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const idOrSlug = parseVideoIdParam(videoIdParam);
  if (!idOrSlug) {
    return jsonResponse({ error: 'Invalid video id' }, 400, corsHeaders);
  }

  const db = getDb(env);
  if (!db) return jsonResponse({ error: 'Database not configured' }, 503, corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  const positionSeconds = normalizePositionSeconds(body.positionSeconds);
  if (positionSeconds == null) {
    return jsonResponse(
      { error: 'positionSeconds must be a non-negative number' },
      400,
      corsHeaders,
    );
  }

  const durationSeconds = normalizeOptionalDurationSeconds(body.durationSeconds);
  const force = body.force === true || body.flush === true;
  const serverNowMs = Date.now();
  const capturedAtMs = normalizeClientCapturedAtMs(
    normalizeCapturedAtMs(body.capturedAtMs),
    serverNowMs,
  );

  const videoId = await resolveVideoId(db, idOrSlug);
  if (!videoId) return jsonResponse({ error: 'Video not found' }, 404, corsHeaders);

  let effectiveDuration = durationSeconds;
  if (effectiveDuration == null) {
    const videoRow = await db
      .prepare('SELECT full_duration FROM videos WHERE id = ?')
      .bind(videoId)
      .first();
    const fromDb = Number(videoRow?.full_duration);
    if (Number.isFinite(fromDb) && fromDb > 0) effectiveDuration = fromDb;
  }

  const classification = classifyPlaybackPosition(positionSeconds, effectiveDuration);

  if (classification === 'ignore') {
    return jsonResponse({ error: 'Invalid playback position' }, 400, corsHeaders);
  }

  if (classification === 'clear') {
    await db
      .prepare('DELETE FROM playback_positions WHERE user_id = ? AND video_id = ?')
      .bind(user.sub, videoId)
      .run();
    return jsonResponse({ videoId, positionSeconds: null, cleared: true }, 200, corsHeaders);
  }

  const existing = await db
    .prepare(
      `SELECT position_seconds, updated_at, client_captured_at_ms
       FROM playback_positions
       WHERE user_id = ? AND video_id = ?`,
    )
    .bind(user.sub, videoId)
    .first();

  if (
    shouldRejectStalePlaybackWrite({
      existingCapturedAtMs:
        existing?.client_captured_at_ms != null ? Number(existing.client_captured_at_ms) : null,
      incomingCapturedAtMs: capturedAtMs,
      serverNowMs,
    })
  ) {
    return jsonResponse(
      {
        videoId,
        positionSeconds:
          existing?.position_seconds != null ? Number(existing.position_seconds) : null,
        updatedAt: existing?.updated_at ?? null,
        skipped: true,
        reason: 'stale',
      },
      200,
      corsHeaders,
    );
  }

  if (
    shouldThrottlePlaybackWrite({
      lastUpdatedAt: existing?.updated_at,
      force,
    })
  ) {
    return jsonResponse(
      {
        videoId,
        positionSeconds:
          existing?.position_seconds != null ? Number(existing.position_seconds) : null,
        updatedAt: existing?.updated_at ?? null,
        skipped: true,
        reason: 'throttled',
      },
      200,
      corsHeaders,
    );
  }

  const rounded = Math.round(positionSeconds * 100) / 100;

  await db
    .prepare(
      `INSERT INTO playback_positions (
         user_id, video_id, position_seconds, client_captured_at_ms, updated_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, video_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         client_captured_at_ms = excluded.client_captured_at_ms,
         updated_at = CURRENT_TIMESTAMP
       WHERE excluded.client_captured_at_ms >= playback_positions.client_captured_at_ms`,
    )
    .bind(user.sub, videoId, rounded, capturedAtMs)
    .run();

  const saved = await db
    .prepare(
      `SELECT position_seconds, updated_at, client_captured_at_ms
       FROM playback_positions
       WHERE user_id = ? AND video_id = ?`,
    )
    .bind(user.sub, videoId)
    .first();

  if (saved?.client_captured_at_ms != null && Number(saved.client_captured_at_ms) > capturedAtMs) {
    return jsonResponse(
      {
        videoId,
        positionSeconds: saved.position_seconds != null ? Number(saved.position_seconds) : null,
        updatedAt: saved.updated_at ?? null,
        skipped: true,
        reason: 'stale',
      },
      200,
      corsHeaders,
    );
  }

  return jsonResponse(
    {
      videoId,
      positionSeconds: rounded,
      updatedAt: saved?.updated_at ?? new Date().toISOString(),
      cleared: false,
    },
    200,
    corsHeaders,
  );
}
