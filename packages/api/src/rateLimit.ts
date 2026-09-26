/**
 * packages/api/src/rateLimit.ts
 *
 * D1-backed hourly rate limiter for anonymous *watch* opens (free previews).
 *
 * Counter key: (client_key, bucket_hour) where bucket_hour = YYYY-MM-DDTHH in UTC.
 * client_key is SHA-256 of a server-issued anonymous id cookie (HMAC-signed,
 * HttpOnly) — not User-Agent or client IP — so the id is stable for a browser
 * and cannot be forged without the API signing secret.
 *
 * Playable anonymous access must send WATCH_VIEW_HEADER (intentional /watch).
 * Warmup/prefetch requests omit the header and must not receive signed playlists.
 *
 * The limit value is read from admin_settings (key "rate_limit_anon", default 5)
 * via settingsStore/getSetting. TTL caching is delegated to settingsStore.
 */

import { hashToken } from './auth.js';
import { getSetting } from './settingsStore.js';

/** Sent by the web /watch page so only real watch opens increment the counter. */
export const WATCH_VIEW_HEADER = 'X-VMP-Watch-View';

/** HttpOnly cookie carrying the signed anonymous viewer id. */
export const ANON_ID_COOKIE_NAME = 'vmp_anon_id';

/** ~13 months — long enough to stay stable across sessions. */
export const ANON_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/**
 * When minting a new anon cookie (no valid cookie presented), also enforce
 * rate_limit_anon × this multiplier per client IP / UTC hour so discarding
 * Set-Cookie cannot mint unlimited fresh identities.
 */
export const ANON_IP_BURST_LIMIT_MULTIPLIER = 10;

export type AnonymousClientIdentity = {
  /** Opaque random id (UUID). */
  rawId: string;
  /** DB counter key (SHA-256 hex of rawId). */
  clientKey: string;
  /** Set-Cookie header value when the id was minted or rotated; otherwise null. */
  setCookie: string | null;
};

export type AnonymousRateLimitResult = {
  limited: boolean;
  current: number;
  limit: number;
  retryAfter?: number;
};

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
 * Prefetch / catalog warmups omit the header and must not receive playable access.
 */
export function isAnonymousWatchViewRequest(request: { headers: Headers }): boolean {
  const value = request.headers.get(WATCH_VIEW_HEADER)?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

function hexFromBytes(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function importAnonHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signAnonId(secret: string, rawId: string): Promise<string> {
  const key = await importAnonHmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`vmp-anon-id:${rawId}`),
  );
  return hexFromBytes(new Uint8Array(sig));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function readAnonIdCookie(request: { headers: Headers }): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${ANON_ID_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim() || null;
  }
}

function buildAnonIdCookie(value: string, maxAge = ANON_ID_COOKIE_MAX_AGE_SECONDS): string {
  return [
    `${ANON_ID_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ].join('; ');
}

function isPlausibleAnonRawId(rawId: string): boolean {
  // crypto.randomUUID() shape; reject empty / oversized client junk.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId);
}

/**
 * Resolve (or mint) a server-issued anonymous viewer id from the signed cookie.
 * Returns null when JWT_SECRET is missing (cannot sign). Watch-view callers
 * must fail closed — do not issue playable access without an identity.
 */
export async function resolveAnonymousClientIdentity(
  request: { headers: Headers },
  env: { JWT_SECRET?: string },
): Promise<AnonymousClientIdentity | null> {
  const secret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
  if (!secret) return null;

  const rawCookie = readAnonIdCookie(request);
  if (rawCookie) {
    const sep = rawCookie.lastIndexOf('.');
    if (sep > 0) {
      const rawId = rawCookie.slice(0, sep);
      const providedSig = rawCookie.slice(sep + 1).toLowerCase();
      if (isPlausibleAnonRawId(rawId) && /^[0-9a-f]{64}$/.test(providedSig)) {
        const expectedSig = await signAnonId(secret, rawId);
        if (timingSafeEqualHex(providedSig, expectedSig)) {
          return {
            rawId,
            clientKey: await hashToken(`anon-preview-id:${rawId}`),
            setCookie: null,
          };
        }
      }
    }
  }

  const rawId = crypto.randomUUID();
  const sig = await signAnonId(secret, rawId);
  const cookieValue = `${rawId}.${sig}`;
  return {
    rawId,
    clientKey: await hashToken(`anon-preview-id:${rawId}`),
    setCookie: buildAnonIdCookie(cookieValue),
  };
}

function clientIpFromRequest(request: { headers: Headers }): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function utcHourKey(now = new Date()): string {
  return now.toISOString().slice(0, 13);
}

function retryAfterSecondsInUtcHour(now = new Date()): number {
  const minutesElapsed = now.getUTCMinutes();
  const secondsElapsed = now.getUTCSeconds();
  return (60 - minutesElapsed) * 60 - secondsElapsed;
}

async function incrementAnonymousBucket(
  db: any,
  bucketKey: string,
  hourKey: string,
): Promise<number> {
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
    .bind(bucketKey, hourKey)
    .first();
  return Number.parseInt(String(upsert?.request_count ?? 0), 10) || 0;
}

/**
 * Check (and increment) the hourly counter for an anonymous *watch* open.
 *
 * When `applyIpBurstLimit` is true (caller minted a new cookie — `setCookie`
 * non-null), also increments a coarser per-IP hourly bucket at
 * rate_limit_anon × ANON_IP_BURST_LIMIT_MULTIPLIER so cookie-discarding
 * clients cannot evade the preview quota. Valid-cookie requests skip the IP
 * burst check.
 *
 * Returns:
 *   null                              — D1 binding not configured, rate limiting skipped
 *   { limited: false, current, limit } — request is allowed
 *   { limited: true, retryAfter, limit, current } — request is blocked (429)
 */
export async function checkAnonymousRateLimit(
  env: any,
  clientKey: string,
  ctx?: ExecutionContext,
  options?: {
    request?: { headers: Headers };
    /** True when resolveAnonymousClientIdentity returned a new Set-Cookie. */
    applyIpBurstLimit?: boolean;
  },
): Promise<AnonymousRateLimitResult | null> {
  const db = env.DB || env.video_subscription_db;
  if (!db) return null; // Database binding not configured — skip silently

  const now = new Date();
  const hourKey = utcHourKey(now);

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
    current = await incrementAnonymousBucket(db, clientKey, hourKey);
  } catch (error) {
    // Fail-open for anonymous traffic when D1 is transiently unavailable.
    console.error('Anonymous rate-limit counter upsert failed; allowing request', {
      hourKey,
      error,
    });
    current = 0;
  }

  if (current > limit) {
    return { limited: true, retryAfter: retryAfterSecondsInUtcHour(now), limit, current };
  }

  if (options?.applyIpBurstLimit && options.request) {
    const ip = clientIpFromRequest(options.request);
    const ipBurstKey = await hashToken(`anon-preview-ip-burst:${ip}`);
    const ipBurstLimit = Math.max(limit * ANON_IP_BURST_LIMIT_MULTIPLIER, limit);
    let ipCurrent = 0;
    try {
      ipCurrent = await incrementAnonymousBucket(db, ipBurstKey, hourKey);
    } catch (error) {
      console.error('Anonymous IP burst rate-limit upsert failed; allowing request', {
        hourKey,
        error,
      });
      ipCurrent = 0;
    }
    if (ipCurrent > ipBurstLimit) {
      return {
        limited: true,
        retryAfter: retryAfterSecondsInUtcHour(now),
        limit: ipBurstLimit,
        current: ipCurrent,
      };
    }
  }

  return { limited: false, current, limit };
}
