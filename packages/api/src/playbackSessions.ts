/**
 * Concurrent playback session limits for club entitlements (#649).
 *
 * POST   /api/account/playback-sessions              mint a server-issued session
 * PUT    /api/account/playback-sessions/:sessionId   heartbeat ({ videoId, ended? })
 * DELETE /api/account/playback-sessions/:sessionId   explicit release
 *
 * `/api/video-access` calls `enforceConcurrentPlaybackLimit`. When
 * `concurrent_playback_enforced` is on, premium access requires a
 * server-issued session id (minted by POST) bound to the authenticated user
 * via `X-VMP-Playback-Session`. Client-selected ids cannot create slots.
 * Limits resolve per `plan_type` from `admin_settings` (1 default, 3 for club);
 * staff roles bypass upstream. Enforcement ships disabled.
 *
 * A session is "active" when its `last_seen_at` falls inside the stale window
 * (default 90s). Slot claims use an atomic INSERT…WHERE count < limit so
 * concurrent creates cannot both succeed at capacity.
 */

import { requireAuth } from './auth.js';
import { capturePostHogEvent, type PostHogWaitUntilCtx } from './posthog.js';
import { getSetting } from './settingsStore.js';

/** Canonical request header name — included in OPTIONS Access-Control-Allow-Headers. */
export const PLAYBACK_SESSION_HEADER_NAME = 'X-VMP-Playback-Session';

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

/** Session id: single path segment, bounded length (server-minted UUIDs satisfy this). */
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

async function getActiveSubscriptionPlanType(db: any, userId: string): Promise<unknown> {
  const row = await db
    .prepare(
      `SELECT plan_type FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'trialing')
         AND (current_period_end IS NULL OR datetime(current_period_end) > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first();
  return row?.plan_type;
}

/**
 * Atomically claim a new playback slot when under the plan limit.
 * Returns true when a row was inserted; false when capacity is exhausted.
 * Mirrors the offline-device `INSERT…SELECT WHERE count < limit` pattern.
 */
export async function claimPlaybackSessionSlot(
  db: any,
  params: {
    sessionId: string;
    userId: string;
    videoId: string;
    limit: number;
    staleSeconds: number;
  },
): Promise<boolean> {
  const insertResult = await db
    .prepare(
      `INSERT INTO playback_sessions (id, user_id, video_id, started_at, last_seen_at)
       SELECT ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       WHERE (
         SELECT COUNT(*) FROM playback_sessions
         WHERE user_id = ?
           AND datetime(last_seen_at) >= datetime('now', ?)
       ) < ?`,
    )
    .bind(
      params.sessionId,
      params.userId,
      params.videoId,
      params.userId,
      `-${params.staleSeconds} seconds`,
      params.limit,
    )
    .run();
  return Boolean(insertResult?.meta?.changes);
}

/** Refresh an existing session owned by this user. Returns false when no matching row. */
async function touchOwnedPlaybackSession(
  db: any,
  sessionId: string,
  userId: string,
  videoId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE playback_sessions
       SET video_id = ?, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
    .bind(videoId, sessionId, userId)
    .run();
  return Boolean(result?.meta?.changes);
}

function rejectedLimitResponse(
  env: any,
  ctx: PostHogWaitUntilCtx | undefined,
  request: Request,
  params: {
    userId: string;
    planType: unknown;
    videoId: string;
    limit: number;
    activeSessions: number;
    corsHeaders: CorsHeaders;
  },
) {
  capturePostHogEvent(
    env,
    {
      distinctId: params.userId,
      event: 'concurrent_playback_rejected',
      properties: {
        plan_type: params.planType ?? 'unknown',
        limit: params.limit,
        active_sessions: params.activeSessions,
        video_id: params.videoId,
      },
    },
    ctx ? { request, ctx } : { request },
  );
  return jsonResponse(
    {
      error: 'Concurrent stream limit reached',
      code: 'concurrent_playback_limit',
      limit: params.limit,
    },
    409,
    params.corsHeaders,
  );
}

/**
 * Video-access gate. When enforcement is on, requires a server-issued session
 * bound to the caller (minted via POST); missing or client-invented ids are
 * rejected. Otherwise returns `null` (proceed). Callers apply the staff bypass.
 */
export async function enforceConcurrentPlaybackLimit(
  request: Request,
  env: any,
  _ctx: PostHogWaitUntilCtx | undefined,
  params: {
    userId: string;
    planType: unknown;
    videoId: string;
    corsHeaders: CorsHeaders;
  },
): Promise<Response | null> {
  const settings = await getPlaybackSessionSettings(env);
  if (!settings.enforced) return null;

  const sessionId = normalizeSessionId(request.headers.get(PLAYBACK_SESSION_HEADER));
  if (!sessionId) {
    return jsonResponse(
      {
        error: 'Playback session required',
        code: 'playback_session_required',
      },
      409,
      params.corsHeaders,
    );
  }

  const db = getDb(env);
  const touched = await touchOwnedPlaybackSession(db, sessionId, params.userId, params.videoId);
  if (!touched) {
    // Unknown / other-user / client-selected ids cannot mint a slot here.
    return jsonResponse(
      {
        error: 'Playback session required',
        code: 'playback_session_required',
      },
      409,
      params.corsHeaders,
    );
  }

  return null;
}

/** Mint a server-issued session id and claim a concurrent-playback slot. */
export async function handleCreatePlaybackSession(
  request: Request,
  env: any,
  corsHeaders: CorsHeaders,
  ctx?: PostHogWaitUntilCtx,
) {
  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
  if (!videoId || videoId.length > 200) {
    return jsonResponse({ error: 'videoId is required' }, 400, corsHeaders);
  }

  const db = getDb(env);
  const settings = await getPlaybackSessionSettings(env);
  const planType = await getActiveSubscriptionPlanType(db, user.sub);
  const limit = resolveConcurrentPlaybackLimit(planType, settings);
  const sessionId = crypto.randomUUID();

  if (settings.enforced) {
    const claimed = await claimPlaybackSessionSlot(db, {
      sessionId,
      userId: user.sub,
      videoId,
      limit,
      staleSeconds: settings.staleSeconds,
    });
    if (!claimed) {
      return rejectedLimitResponse(env, ctx, request, {
        userId: user.sub,
        planType,
        videoId,
        limit,
        activeSessions: limit,
        corsHeaders,
      });
    }
  } else {
    await db
      .prepare(
        `INSERT INTO playback_sessions (id, user_id, video_id, started_at, last_seen_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(sessionId, user.sub, videoId)
      .run();
  }

  return jsonResponse({ sessionId, ok: true }, 201, corsHeaders);
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

  // Heartbeat refreshes server-issued rows only — never creates from a client id.
  const touched = await touchOwnedPlaybackSession(db, sessionId, user.sub, videoId);
  if (!touched) {
    return jsonResponse(
      { error: 'Playback session not found', code: 'playback_session_required' },
      404,
      corsHeaders,
    );
  }
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
