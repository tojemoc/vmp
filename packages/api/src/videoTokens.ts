/**
 * packages/api/src/videoTokens.js
 *
 * Short-lived HMAC-SHA-256 tokens used by /api/video-proxy to authorize
 * manifest/segment requests without requiring Authorization headers.
 *
 * Token format:
 *   base64url(payload) + "." + hex(HMAC-SHA256(base64url(payload)))
 * where payload = "<userId>:<videoId>:<unixExpires>:<previewUntilSecondsOrEmpty>[:<rssTokenVersion>]"
 * The optional rssTokenVersion suffix binds RSS-issued tokens to the user's current
 * rss_token_version so rotation invalidates outstanding podcast enclosure URLs.
 */

import { normalizeRssTokenVersion, type RssTokenVersionLookup } from './rssToken.js';

function b64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(b64url: string): string {
  const padded =
    b64url.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (b64url.length % 4)) % 4);
  return atob(padded);
}

async function importVideoHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

interface SignVideoTokenOptions {
  ttlSeconds?: number;
  rssTokenVersion?: number;
}

/** Default web playback token TTL; RSS enclosures use a much longer TTL. */
export const WEB_VIDEO_TOKEN_MAX_TTL_SECONDS = 7200;

export interface VideoTokenClaims {
  userId: string;
  videoId: string;
  expires: number;
  previewUntil: number | null;
  rssTokenVersion: number | null;
}

export type VideoTokenRssVersionCheck = 'ok' | 'forbidden' | 'unavailable';

/** True when a signed token lacks rss_token_version but has RSS-length TTL. */
export function isLegacyRssVideoTokenWithoutVersion(claims: VideoTokenClaims): boolean {
  if (claims.userId === 'anonymous' || claims.rssTokenVersion !== null) return false;
  const ttlRemaining = claims.expires - Math.floor(Date.now() / 1000);
  return ttlRemaining > WEB_VIDEO_TOKEN_MAX_TTL_SECONDS;
}

export function checkVideoTokenRssVersion(
  claims: VideoTokenClaims,
  lookup: RssTokenVersionLookup,
): VideoTokenRssVersionCheck {
  if (claims.userId === 'anonymous') return 'ok';
  if (!lookup.ok) return 'unavailable';
  if (claims.rssTokenVersion !== null) {
    return lookup.version === claims.rssTokenVersion ? 'ok' : 'forbidden';
  }
  return isLegacyRssVideoTokenWithoutVersion(claims) ? 'forbidden' : 'ok';
}

export async function signVideoToken(
  userId: string,
  videoId: string,
  secret: string,
  previewUntil: number | null = null,
  opts: SignVideoTokenOptions = {},
) {
  const ttlSeconds = Number.isFinite(opts.ttlSeconds)
    ? Math.max(60, Math.floor(opts.ttlSeconds as number))
    : 7200;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const previewUntilStr =
    previewUntil !== null && Number.isFinite(previewUntil) ? String(previewUntil) : '';
  let payloadPlain = `${userId}:${videoId}:${expires}:${previewUntilStr}`;
  if (opts.rssTokenVersion !== undefined) {
    payloadPlain += `:${normalizeRssTokenVersion(opts.rssTokenVersion)}`;
  }
  const payload = b64urlEncode(payloadPlain);
  const key = await importVideoHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${payload}.${sigHex}`;
}

export async function verifyVideoToken(token: string, secret: string) {
  if (!token || typeof token !== 'string') throw new Error('Missing video token');
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex < 1) throw new Error('Malformed video token');

  const payload = token.slice(0, dotIndex);
  const sigHex = token.slice(dotIndex + 1);

  if (!sigHex || typeof sigHex !== 'string') {
    throw new Error('Malformed video token signature');
  }
  if (sigHex.length === 0 || sigHex.length % 2 !== 0) {
    throw new Error('Malformed video token signature');
  }
  if (!/^[0-9a-fA-F]+$/.test(sigHex)) {
    throw new Error('Malformed video token signature');
  }

  const key = await importVideoHmacKey(secret);
  try {
    const sigBytes = new Uint8Array(sigHex.match(/../g)!.map((h) => parseInt(h, 16)));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    if (!valid) throw new Error('Invalid video token signature');
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Invalid video token signature') throw error;
    throw new Error('Malformed video token signature');
  }

  const decoded = b64urlDecode(payload);
  const parts = decoded.split(':');
  if (parts.length < 3) throw new Error('Malformed video token payload');

  const userId = parts[0];
  const videoId = parts[1];
  const expiresRaw = parts[2];
  if (!userId || !videoId || !expiresRaw) throw new Error('Malformed video token payload');
  const expires = parseInt(expiresRaw, 10);
  if (!Number.isFinite(expires)) throw new Error('Malformed video token payload');
  const previewUntilRaw = parts[3] ? (parts[3] !== '' ? parseFloat(parts[3]) : null) : null;
  const previewUntil =
    previewUntilRaw !== null && Number.isFinite(previewUntilRaw) ? previewUntilRaw : null;

  let rssTokenVersion: number | null = null;
  if (parts.length >= 5 && parts[4] !== undefined && parts[4] !== '') {
    const parsedVersion = parseInt(parts[4], 10);
    if (!Number.isFinite(parsedVersion)) throw new Error('Malformed video token payload');
    rssTokenVersion = normalizeRssTokenVersion(parsedVersion);
  }

  if (Math.floor(Date.now() / 1000) > expires) throw new Error('Video token expired');

  return { userId, videoId, expires, previewUntil, rssTokenVersion } satisfies VideoTokenClaims;
}
