/**
 * Auth-gated last-playback-position store for VOD resume (#488).
 *
 * GET  /api/account/playback-positions/:videoId
 * PUT  /api/account/playback-positions/:videoId  { positionSeconds, durationSeconds? }
 *
 * Writes are intentionally cheap to spam: server enforces a short cooldown per
 * user/video unless the client marks the write as a flush (navigate-away / next video).
 */

import { requireAuth } from './auth.js';

/** Minimum meaningful watch position before we persist (seconds). */
export const PLAYBACK_POSITION_MIN_SAVE_SECONDS = 5;

/** Treat as finished when within this many seconds of the end. */
export const PLAYBACK_POSITION_END_EPSILON_SECONDS = 30;

/** Fraction of duration at/above which we clear the saved position. */
export const PLAYBACK_POSITION_END_FRACTION = 0.95;

/** Minimum interval between non-flush upserts for the same user/video. */
export const PLAYBACK_POSITION_MIN_WRITE_INTERVAL_MS = 5000;

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
    const remaining = durationSeconds - positionSeconds;
    if (
      remaining <= PLAYBACK_POSITION_END_EPSILON_SECONDS ||
      positionSeconds / durationSeconds >= PLAYBACK_POSITION_END_FRACTION
    ) {
      return 'clear';
    }
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
      `SELECT position_seconds, updated_at
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
      `SELECT position_seconds, updated_at
       FROM playback_positions
       WHERE user_id = ? AND video_id = ?`,
    )
    .bind(user.sub, videoId)
    .first();

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
      `INSERT INTO playback_positions (user_id, video_id, position_seconds, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, video_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(user.sub, videoId, rounded)
    .run();

  return jsonResponse(
    {
      videoId,
      positionSeconds: rounded,
      updatedAt: new Date().toISOString(),
      cleared: false,
    },
    200,
    corsHeaders,
  );
}
