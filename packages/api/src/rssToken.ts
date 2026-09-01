/**
 * packages/api/src/rssToken.js
 *
 * Shared HMAC helper for stable per-user RSS feed tokens.
 */

function hexFromBytes(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function importRssHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Normalize an untrusted token version into a non-negative integer. */
export function normalizeRssTokenVersion(rawVersion: unknown): number {
  const value = Math.trunc(Number(rawVersion));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Read the current RSS token version for a user, tolerating a not-yet-migrated column. */
export async function readRssTokenVersion(db: any, userId: string): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT rss_token_version FROM users WHERE id = ? LIMIT 1')
      .bind(userId)
      .first();
    return normalizeRssTokenVersion(row?.rss_token_version);
  } catch {
    return 0;
  }
}

export async function computeRssTokenHex(
  rssSecret: string,
  userId: string,
  tokenVersion: unknown = 0,
): Promise<string> {
  const version = normalizeRssTokenVersion(tokenVersion);
  const key = await importRssHmacKey(rssSecret);
  const msg = new TextEncoder().encode(
    version === 0 ? `rss:${userId}` : `rss:${userId}:${version}`,
  );
  const sig = await crypto.subtle.sign('HMAC', key, msg);
  return hexFromBytes(new Uint8Array(sig));
}
