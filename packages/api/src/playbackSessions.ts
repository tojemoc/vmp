/**
 * Concurrent playback session limits for club entitlements (#649).
 *
 * PUT    /api/account/playback-sessions/:sessionId   heartbeat / register ({ videoId, ended? })
 * DELETE /api/account/playback-sessions/:sessionId   explicit release
 *
 * `/api/video-access` calls `enforceConcurrentPlaybackLimit`, which counts a
 * user's active sessions and rejects a new stream once the plan limit is
 * reached. Limits resolve per `plan_type` from `admin_settings` (1 default, 3
 * for club); staff roles bypass upstream. Enforcement is gated by
 * `concurrent_playback_enforced` and ships disabled.
 *
 * A session is "active" when its `last_seen_at` falls inside the stale window
 * (default 90s). The client sends its session id on the heartbeat routes and as
 * the `X-VMP-Playback-Session` header on video-access.
 */

import { requireAuth } from './auth.js';
import { capturePostHogEvent, type PostHogWaitUntilCtx } from './posthog.js';
import { getSetting } from './settingsStore.js';

/** Header the player sends on /api/video-access to identify its stream slot. */
const PLAYBACK_SESSION_HEADER = 'x-vmp-playback-session';

interface PlaybackSessionSettings {
  enforced: boolean;
  limitDefault: number;
  limitClub: number;
  staleSeconds: number;
}

type CorsHeaders = Record<string, string>;

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db;
  if (!db) throw new Error('D1 binding not found');
  return db;
}

function jsonResponse(data: unknown, status = 200, corsHeaders: CorsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** Parses a stored setting as a positive integer, falling back when absent or invalid. */
function parsePositiveInt(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePlaybackSessionSettings(raw: {
  enforced: unknown;
  limitDefault: unknown;
  limitClub: unknown;
  staleSeconds: unknown;
}): PlaybackSessionSettings {
  const enforced = String(raw.enforced ?? '')
    .trim()
    .toLowerCase();
  return {
    enforced: enforced === '1' || enforced === 'true',
    limitDefault: parsePositiveInt(raw.limitDefault, 1),
    limitClub: parsePositiveInt(raw.limitClub, 3),
    staleSeconds: parsePositiveInt(raw.staleSeconds, 90),
  };
}

async function getPlaybackSessionSettings(env: any): Promise<PlaybackSessionSettings> {
  const [enforced, limitDefault, limitClub, staleSeconds] = await Promise.all([
    getSetting(env, 'concurrent_playback_enforced', { ttlSeconds: 300, defaultValue: '0' }),
    getSetting(env, 'concurrent_playback_limit_default', { ttlSeconds: 300, defaultValue: '1' }),
    getSetting(env, 'concurrent_playback_limit_club', { ttlSeconds: 300, defaultValue: '3' }),
    getSetting(env, 'concurrent_playback_stale_seconds', { ttlSeconds: 300, defaultValue: '90' }),
  ]);
  return parsePlaybackSessionSettings({ enforced, limitDefault, limitClub, staleSeconds });
}

/** Max concurrent streams for a plan: club gets its own cap, everyone else the default. */
export function resolveConcurrentPlaybackLimit(
  planType: unknown,
  settings: PlaybackSessionSettings,
): number {
  const plan = String(planType ?? '')
    .trim()
    .toLowerCase();
  return plan === 'club' ? settings.limitClub : settings.limitDefault;
}

/** Client-generated session id: single path segment, bounded length. */
export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const trimmed = decoded.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (trimmed.includes('/') || trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

/** Count the user's other active sessions — seen within the stale window, excluding their own. */
async function countActivePlaybackSessions(
  db: any,
  userId: string,
  sessionId: string,
  staleSeconds: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM playback_sessions
       WHERE user_id = ? AND id != ? AND datetime(last_seen_at) >= datetime('now', ?)`,
    )
    .bind(userId, sessionId, `-${staleSeconds} seconds`)
    .first();
  return Number(row?.n ?? 0);
}

/** Register a new session or refresh its heartbeat, without letting one user overwrite another's row. */
async function upsertPlaybackSession(
  db: any,
  sessionId: string,
  userId: string,
  videoId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO playback_sessions (id, user_id, video_id, started_at, last_seen_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         video_id = excluded.video_id,
         last_seen_at = CURRENT_TIMESTAMP
       WHERE playback_sessions.user_id = excluded.user_id`,
    )
    .bind(sessionId, userId, videoId)
    .run();
}

/**
 * Video-access gate. Returns a 409 `Response` when the caller's plan limit is
 * reached, otherwise claims the stream slot and returns `null` (proceed).
 * Inert when the player sends no session id or the flag is off, so enabling the
 * flag alone cannot break existing clients. Callers apply the staff bypass.
 */
export async function enforceConcurrentPlaybackLimit(
  request: Request,
  env: any,
  ctx: PostHogWaitUntilCtx | undefined,
  params: {
    userId: string;
    planType: unknown;
    videoId: string;
    corsHeaders: CorsHeaders;
  },
): Promise<Response | null> {
  const sessionId = normalizeSessionId(request.headers.get(PLAYBACK_SESSION_HEADER));
  if (!sessionId) return null;

  const settings = await getPlaybackSessionSettings(env);
  if (!settings.enforced) return null;

  const db = getDb(env);
  const limit = resolveConcurrentPlaybackLimit(params.planType, settings);
  const activeOther = await countActivePlaybackSessions(
    db,
    params.userId,
    sessionId,
    settings.staleSeconds,
  );

  if (activeOther >= limit) {
    capturePostHogEvent(
      env,
      {
        distinctId: params.userId,
        event: 'concurrent_playback_rejected',
        properties: {
          plan_type: params.planType ?? 'unknown',
          limit,
          active_sessions: activeOther,
          video_id: params.videoId,
        },
      },
      ctx ? { request, ctx } : { request },
    );
    return jsonResponse(
      { error: 'Concurrent stream limit reached', code: 'concurrent_playback_limit', limit },
      409,
      params.corsHeaders,
    );
  }

  // Claim the slot now so the count is consistent before the first heartbeat.
  await upsertPlaybackSession(db, sessionId, params.userId, params.videoId);
  return null;
}

export async function handlePlaybackSessionHeartbeat(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  sessionIdParam: string,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const sessionId = normalizeSessionId(sessionIdParam);
  if (!sessionId) return jsonResponse({ error: 'Invalid session id' }, 400, corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  const db = getDb(env);

  if (body.ended === true) {
    await db
      .prepare('DELETE FROM playback_sessions WHERE id = ? AND user_id = ?')
      .bind(sessionId, user.sub)
      .run();
    return jsonResponse({ sessionId, ended: true }, 200, corsHeaders);
  }

  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
  if (!videoId || videoId.length > 200) {
    return jsonResponse({ error: 'videoId is required' }, 400, corsHeaders);
  }

  await upsertPlaybackSession(db, sessionId, user.sub, videoId);
  return jsonResponse({ sessionId, ok: true }, 200, corsHeaders);
}

export async function handleReleasePlaybackSession(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  sessionIdParam: string,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const sessionId = normalizeSessionId(sessionIdParam);
  if (!sessionId) return jsonResponse({ error: 'Invalid session id' }, 400, corsHeaders);

  const db = getDb(env);
  await db
    .prepare('DELETE FROM playback_sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, user.sub)
    .run();
  return jsonResponse({ sessionId, released: true }, 200, corsHeaders);
}
