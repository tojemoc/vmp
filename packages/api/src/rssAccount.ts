/**
 * packages/api/src/rssAccount.js
 *
 * Account helper endpoints to return and rotate the signed-in user's RSS feed URLs.
 * Podcast clients typically cannot send Authorization headers, so the personal
 * feed URL carries a stable HMAC token. The token folds in a per-user
 * `rss_token_version`; rotating it invalidates every previously issued URL.
 */

import { requireAuth } from './auth.js';
import { getDb } from './d1Session.js';
import { getRequestPublicOrigin } from './requestPublicOrigin.js';
import { computeRssTokenHex, normalizeRssTokenVersion } from './rssToken.js';

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** Read the current RSS token version for a user, tolerating a not-yet-migrated column. */
async function readRssTokenVersion(db: any, userId: string): Promise<number> {
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

async function buildRssUrls(request: any, env: any, userId: string, tokenVersion: number) {
  const rssSecret = env.RSS_SECRET?.trim();
  const origin = getRequestPublicOrigin(request, env);
  const token = await computeRssTokenHex(rssSecret, userId, tokenVersion);
  return {
    publicUrl: `${origin}/api/feed/public`,
    personalUrl: `${origin}/api/feed/${encodeURIComponent(userId)}/${token}`,
  };
}

export async function handleGetAccountRss(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const rssSecret = env.RSS_SECRET?.trim();
  if (!rssSecret) {
    return jsonResponse({ error: 'RSS not configured' }, 503, corsHeaders);
  }

  const db = getDb(env);
  const tokenVersion = await readRssTokenVersion(db, user.sub);
  const urls = await buildRssUrls(request, env, user.sub, tokenVersion);
  return jsonResponse(urls, 200, corsHeaders);
}

export async function handleRotateAccountRss(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const rssSecret = env.RSS_SECRET?.trim();
  if (!rssSecret) {
    return jsonResponse({ error: 'RSS not configured' }, 503, corsHeaders);
  }

  const db = getDb(env);
  let newVersion: number;
  try {
    const row = await db
      .prepare(
        `UPDATE users
         SET rss_token_version = COALESCE(rss_token_version, 0) + 1
         WHERE id = ?
         RETURNING rss_token_version`,
      )
      .bind(user.sub)
      .first();
    if (!row) {
      return jsonResponse({ error: 'Not Found' }, 404, corsHeaders);
    }
    newVersion = normalizeRssTokenVersion(row.rss_token_version);
  } catch (err) {
    console.error('[rss] rotate failed:', err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: 'Internal error', code: 'internal_error' }, 500, corsHeaders);
  }

  const urls = await buildRssUrls(request, env, user.sub, newVersion);
  return jsonResponse(urls, 200, corsHeaders);
}
