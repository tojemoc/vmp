/**
 * Public (non-video) object proxy and URL helpers for private B2 origin.
 *
 * Video HLS/podcast stays on /api/video-proxy with vt tokens.
 * Thumbnails, CMS media, and pills images are allowlisted under /api/assets/*.
 */

import {
  getObjectStorage,
  parseHttpRangeHeader,
  storageGetResultToResponse,
  type StorageEnv,
} from './objectStorage.js';

export const PUBLIC_ASSET_PREFIXES = ['thumbnails/', 'cms/', 'pills/'] as const;

export const PUBLIC_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type PublicAssetEnv = StorageEnv & {
  API_PUBLIC_URL?: string;
  API_URL?: string;
  /** @deprecated Legacy public object CDN; used only to rewrite stored URLs. */
  R2_BASE_URL?: string;
};

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return '';
}

/** Public API origin used when minting absolute /api/assets URLs (no request context). */
export function getPublicApiOrigin(env: PublicAssetEnv): string | null {
  const raw = firstNonEmpty(env.API_PUBLIC_URL, env.API_URL);
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

export function isAllowlistedPublicAssetKey(key: string): boolean {
  const normalized = key.replace(/^\/+/, '');
  return PUBLIC_ASSET_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Build `https://{api}/api/assets/{key}` (optional cache-buster query). */
export function buildPublicAssetUrl(
  env: PublicAssetEnv,
  key: string,
  query?: string | Record<string, string>,
): string | null {
  const origin = getPublicApiOrigin(env);
  if (!origin) return null;
  const normalized = key.replace(/^\/+/, '');
  if (!isAllowlistedPublicAssetKey(normalized)) return null;
  const url = new URL(`${origin}/api/assets/${normalized}`);
  if (typeof query === 'string' && query) {
    for (const part of query.replace(/^\?/, '').split('&')) {
      if (!part) continue;
      const [k, ...rest] = part.split('=');
      if (k) url.searchParams.set(decodeURIComponent(k), decodeURIComponent(rest.join('=') || ''));
    }
  } else if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/**
 * Extract an allowlisted object key from a stored absolute/relative URL.
 * Supports legacy public R2 CDN URLs and current /api/assets/ URLs.
 */
export function extractPublicAssetKey(storedUrl: string): string | null {
  const raw = storedUrl.trim();
  if (!raw) return null;

  let pathname: string;
  try {
    if (raw.startsWith('/')) {
      pathname = raw.split('?')[0] ?? raw;
    } else {
      pathname = new URL(raw).pathname;
    }
  } catch {
    return null;
  }

  const assetsPrefix = '/api/assets/';
  if (pathname.startsWith(assetsPrefix)) {
    const key = pathname.slice(assetsPrefix.length).replace(/^\/+/, '');
    return isAllowlistedPublicAssetKey(key) ? key : null;
  }

  const stripped = pathname.replace(/^\/+/, '');
  return isAllowlistedPublicAssetKey(stripped) ? stripped : null;
}

/** Rewrite legacy CDN or relative object URLs to the Worker asset proxy. */
export function rewriteStoredPublicObjectUrl(
  storedUrl: string | null | undefined,
  env: PublicAssetEnv,
): string | null {
  if (storedUrl == null) return null;
  const trimmed = String(storedUrl).trim();
  if (!trimmed) return null;

  const key = extractPublicAssetKey(trimmed);
  if (!key) return trimmed;

  let cacheBuster: string | undefined;
  try {
    const u = trimmed.startsWith('/')
      ? new URL(trimmed, 'https://placeholder.invalid')
      : new URL(trimmed);
    cacheBuster = u.searchParams.get('v') ?? undefined;
  } catch {
    /* ignore */
  }

  const rewritten = buildPublicAssetUrl(env, key, cacheBuster ? { v: cacheBuster } : undefined);
  return rewritten ?? trimmed;
}

export function withRewrittenThumbnailUrl<T extends { thumbnail_url?: string | null }>(
  row: T,
  env: PublicAssetEnv,
): T {
  if (!row || row.thumbnail_url == null) return row;
  return {
    ...row,
    thumbnail_url: rewriteStoredPublicObjectUrl(row.thumbnail_url, env),
  };
}

function jsonResponse(body: unknown, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * GET /api/assets/{key} — serve allowlisted public objects from private storage.
 */
export async function handlePublicAsset(
  request: Request,
  env: PublicAssetEnv,
  corsHeaders: HeadersInit,
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const url = new URL(request.url);
  const prefix = '/api/assets/';
  if (!url.pathname.startsWith(prefix)) {
    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  }

  let objectPath = url.pathname.slice(prefix.length);
  try {
    objectPath = decodeURIComponent(objectPath);
  } catch {
    return jsonResponse({ error: 'Invalid asset path' }, 400, corsHeaders);
  }
  objectPath = objectPath.replace(/^\/+/, '');

  if (!objectPath || objectPath.includes('..') || !isAllowlistedPublicAssetKey(objectPath)) {
    return jsonResponse({ error: 'Unsupported asset path' }, 400, corsHeaders);
  }

  const storage = getObjectStorage(env);
  if (!storage) {
    return jsonResponse({ error: 'Object storage not configured' }, 503, corsHeaders);
  }

  const rangeHeader = request.headers.get('Range');
  const byteRange = request.method === 'GET' ? parseHttpRangeHeader(rangeHeader) : undefined;

  try {
    if (request.method === 'HEAD') {
      const head = await storage.headObject(objectPath);
      if (!head) {
        return jsonResponse({ error: 'Asset not found' }, 404, corsHeaders);
      }
      const headers = new Headers({
        'Cache-Control': PUBLIC_ASSET_CACHE_CONTROL,
        ...corsHeaders,
      });
      if (head.contentType) headers.set('Content-Type', head.contentType);
      if (head.size != null) headers.set('Content-Length', String(head.size));
      return new Response(null, { status: 200, headers });
    }

    const object = await storage.getObject(
      objectPath,
      byteRange ? { range: byteRange } : undefined,
    );
    if (!object) {
      return jsonResponse({ error: 'Asset not found' }, 404, corsHeaders);
    }
    const response = storageGetResultToResponse(object);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', PUBLIC_ASSET_CACHE_CONTROL);
    for (const [k, v] of Object.entries(corsHeaders as Record<string, string>)) {
      headers.set(k, v);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (err) {
    console.error('[public-assets] storage read failed:', err);
    return jsonResponse({ error: 'Asset temporarily unavailable' }, 502, corsHeaders);
  }
}

/** Base URL prefix for CMS repository mapMediaRow (`{origin}/api/assets`). */
export function getPublicAssetsBaseUrl(env: PublicAssetEnv): string | null {
  const origin = getPublicApiOrigin(env);
  return origin ? `${origin}/api/assets` : null;
}
