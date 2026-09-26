/**
 * packages/api/src/rateLimit.ts
 *
 * D1-backed hourly rate limiter for anonymous *watch* opens (free previews).
 *
 * Counter key: (ua_fingerprint, bucket_hour) where bucket_hour = YYYY-MM-DDTHH in UTC.
 * Fingerprint is SHA-256 of the User-Agent only (no IP) so shared NATs / CGNAT do not
 * collapse many viewers into one bucket, and segment/proxy traffic never touches this.
 *
 * Callers must only invoke this for intentional /watch opens (see WATCH_VIEW_HEADER).
 * Homepage HLS prefetch and other video-access warmups must not count.
 *
 * The limit value is read from admin_settings (key "rate_limit_anon", default 5)
 * via settingsStore/getSetting. TTL caching is delegated to settingsStore.
 */

import { hashToken } from './auth.js';
import { getSetting } from './settingsStore.js';

/** Sent by the web /watch page so only real watch opens increment the counter. */
export const WATCH_VIEW_HEADER = 'X-VMP-Watch-View';

/**
 * Read rate_limit_anon from admin_settings via settingsStore/getSetting.
 * Falls back to 5 if the row is missing, invalid, or temporarily unreadable.
 */
async function getRateLimitValue(env: any) {
  const parseRateLimit = (raw: any) => {
    const parsed = Number.parseInt(String(raw ?? '5'), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  };

  try {
    const raw = await getSetting(env, 'rate_limit_anon', { ttlSeconds: 60, defaultValue: '5' });
    return parseRateLimit(raw);
  } catch {
    // Keep retries short on transient failures.
    try {
      const retryValue = await getSetting(env, 'rate_limit_anon', {
        ttlSeconds: 5,
        defaultValue: '5',
      });
      return parseRateLimit(retryValue);
    } catch {
      // Best effort only.
    }
    return 5;
  }
}

/**
 * Whether this request is an intentional anonymous watch open that should count.
 * Prefetch / catalog warmups omit the header and must not burn the free-preview budget.
 */
export function isAnonymousWatchViewRequest(request: { headers: Headers }): boolean {
  const value = request.headers.get(WATCH_VIEW_HEADER)?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * Client key for the hourly bucket: SHA-256 of User-Agent only.
 * Stored in the legacy `ip` column of `anonymous_rate_limits` (no schema rename).
 */
export async function anonymousRateLimitClientKey(request: { headers: Headers }): Promise<string> {
  const ua = request.headers.get('User-Agent')?.trim() || 'unknown';
  return hashToken(`anon-preview-ua:${ua}`);
}

/**
 * Check (and increment) the hourly counter for an anonymous *watch* open.
 *
 * Returns:
 *   null                              — D1 binding not configured, rate limiting skipped
 *   { limited: false, current, limit } — request is allowed
 *   { limited: true, retryAfter, limit, current } — request is blocked (429)
 */
export async function checkAnonymousRateLimit(request: any, env: any, ctx?: ExecutionContext) {
  const db = env.DB || env.video_subscription_db;
  if (!db) return null; // Database binding not configured — skip silently

  const clientKey = await anonymousRateLimitClientKey(request);

  const now = new Date();
  // e.g. "2026-03-30T14" — one bucket per UTC hour
  const hourKey = now.toISOString().slice(0, 13);

  // Opportunistic cleanup runs before the counter check and, when available,
  // is dispatched asynchronously to avoid adding latency to request handling.
  if (Math.random() < 0.01) {
    const cleanupPromise = db
      .prepare('DELETE FROM anonymous_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP')
      .run()
      .catch(() => {
        // Cleanup failures are non-fatal for request handling.
      });
    if (ctx?.waitUntil) {
      ctx.waitUntil(cleanupPromise);
    } else {
      await cleanupPromise;
    }
  }

  const limit = await getRateLimitValue(env);
  let current = 0;
  try {
    const upsert = await db
      .prepare(`
      INSERT INTO anonymous_rate_limits (
        ip, bucket_hour, request_count, expires_at, updated_at
      ) VALUES (
        ?, ?, 1, datetime('now', '+3700 seconds'), CURRENT_TIMESTAMP
      )
      ON CONFLICT(ip, bucket_hour) DO UPDATE SET
        request_count = anonymous_rate_limits.request_count + 1,
        expires_at = datetime('now', '+3700 seconds'),
        updated_at = CURRENT_TIMESTAMP
      RETURNING request_count
    `)
      .bind(clientKey, hourKey)
      .first();
    current = Number.parseInt(String(upsert?.request_count ?? 0), 10) || 0;
  } catch (error) {
    // Fail-open for anonymous traffic when D1 is transiently unavailable.
    console.error('Anonymous rate-limit counter upsert failed; allowing request', {
      hourKey,
      error,
    });
    current = 0;
  }

  if (current > limit) {
    // Seconds remaining in the current UTC hour
    const minutesElapsed = now.getUTCMinutes();
    const secondsElapsed = now.getUTCSeconds();
    const retryAfter = (60 - minutesElapsed) * 60 - secondsElapsed;

    return { limited: true, retryAfter, limit, current };
  }

  return { limited: false, current, limit };
}
