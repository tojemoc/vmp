/**
 * Native / TV client auth helpers — device pairing + APNs/FCM token register.
 * See docs/native-clients-plan.md (Phase 0).
 */

import type { NativePushPlatform } from '@vmp/shared';
import { hashToken, issueNativeSessionTokens, requireAuth } from './auth.js';
import { getDb } from './d1Session.js';
import { log } from './logger.js';
import { getSetting } from './settingsStore.js';

const PAIRING_TTL_SEC = 10 * 60;
const PAIRING_POLL_INTERVAL_SEC = 2;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CLEANUP_GRACE_SEC = 24 * 60 * 60;

const PAIRING_LIMIT_SETTINGS = {
  start: { key: 'pairing_start_limit_per_ip', defaultValue: '10' },
  poll: { key: 'pairing_poll_limit_per_ip', defaultValue: '120' },
  preview: { key: 'pairing_preview_limit_per_ip', defaultValue: '30' },
  previewCode: { key: 'pairing_preview_limit_per_code', defaultValue: '8' },
} as const;

function parsePairingLimit(raw: unknown, fallback: string): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  const fallbackParsed = Number.parseInt(fallback, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackParsed;
}

/** Read pairing rate limits from admin_settings (see migration 0046). */
async function getPairingLimit(
  env: any,
  kind: keyof typeof PAIRING_LIMIT_SETTINGS,
): Promise<number> {
  const { key, defaultValue } = PAIRING_LIMIT_SETTINGS[kind];
  try {
    const raw = await getSetting(env, key, { ttlSeconds: 60, defaultValue });
    return parsePairingLimit(raw, defaultValue);
  } catch {
    try {
      const raw = await getSetting(env, key, { ttlSeconds: 5, defaultValue });
      return parsePairingLimit(raw, defaultValue);
    } catch {
      return parsePairingLimit(defaultValue, defaultValue);
    }
  }
}

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function errorResponse(
  error: string,
  status: number,
  corsHeaders: Record<string, string>,
  code?: string,
) {
  return jsonResponse(code ? { error, code } : { error }, status, corsHeaders);
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
}

async function isPairingRateLimited(
  env: any,
  kind: 'start' | 'poll' | 'preview',
  request: Request,
): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return false;
  try {
    const ip = clientIp(request);
    const minuteBucket = Math.floor(Date.now() / 60000);
    const fingerprint = await hashToken(`${kind}:${ip}:${minuteBucket}`);
    const key = `auth:device-pairing:${kind}:${fingerprint}`;
    const limit = await getPairingLimit(env, kind);
    const currentRaw = await kv.get(key);
    const current = Number.parseInt(currentRaw ?? '0', 10);
    const count = Number.isFinite(current) ? current : 0;
    if (count >= limit) return true;
    await kv.put(key, String(count + 1), { expirationTtl: 120 });
    return false;
  } catch {
    return false;
  }
}

async function isPairingPreviewCodeRateLimited(env: any, codeHash: string): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return false;
  try {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const key = `auth:device-pairing:preview-code:${codeHash}:${minuteBucket}`;
    const currentRaw = await kv.get(key);
    const current = Number.parseInt(currentRaw ?? '0', 10);
    const count = Number.isFinite(current) ? current : 0;
    const limit = await getPairingLimit(env, 'previewCode');
    if (count >= limit) return true;
    await kv.put(key, String(count + 1), { expirationTtl: 120 });
    return false;
  } catch {
    return false;
  }
}

/** Redact token/deviceId query fallbacks before any log or error URL. */
export function redactPushDeviceQuery(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.searchParams.has('token')) u.searchParams.set('token', '[redacted]');
    if (u.searchParams.has('deviceId')) u.searchParams.set('deviceId', '[redacted]');
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function cleanupExpiredPairingSessions(db: any): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - PAIRING_CLEANUP_GRACE_SEC * 1000).toISOString();
    await db
      .prepare(`DELETE FROM device_pairing_sessions WHERE datetime(expires_at) < datetime(?)`)
      .bind(cutoff)
      .run();
  } catch {
    // Best-effort retention hygiene; never break pairing.
  }
}

function normalizeOptionalLabel(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed || null;
}

/** Human-friendly 8-char pairing code (no ambiguous 0/O/1/I). */
export function generatePairingCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) {
    out += PAIRING_CODE_ALPHABET[b % PAIRING_CODE_ALPHABET.length];
  }
  return out;
}

export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 6 || normalized.length > 12) return null;
  return normalized;
}

export function normalizeNativePushPlatform(raw: unknown): NativePushPlatform | null {
  if (raw === 'ios' || raw === 'android') return raw;
  return null;
}

/**
 * POST /api/auth/device-pairing/start
 * TV/device begins login — displays pairingCode for the user to enter on phone/web.
 * Optional body: { deviceName?, devicePlatform? } for approval preview.
 */
export async function handleDevicePairingStart(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);
  if (await isPairingRateLimited(env, 'start', request)) {
    return errorResponse(
      'Too many pairing attempts. Try again shortly.',
      429,
      corsHeaders,
      'rate_limited',
    );
  }

  const body = await request.json().catch(() => null);
  const deviceName = normalizeOptionalLabel(body?.deviceName, 80);
  const devicePlatform = normalizeOptionalLabel(body?.devicePlatform, 40);

  const db = getDb(env);
  await cleanupExpiredPairingSessions(db);

  const pairingCode = generatePairingCode();
  const codeHash = await hashToken(pairingCode);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000).toISOString();

  await db
    .prepare(`
      INSERT INTO device_pairing_sessions
        (id, code_hash, status, device_name, device_platform, expires_at)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `)
    .bind(id, codeHash, deviceName, devicePlatform, expiresAt)
    .run();

  return jsonResponse(
    {
      pairingCode,
      expiresAt,
      pollIntervalSeconds: PAIRING_POLL_INTERVAL_SEC,
    },
    201,
    corsHeaders,
  );
}

/**
 * POST /api/auth/device-pairing/preview  body: { pairingCode }
 * Logged-in phone/web inspects device context before approving.
 */
export async function handleDevicePairingPreview(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);
  if (await isPairingRateLimited(env, 'preview', request)) {
    return errorResponse(
      'Too many pairing previews. Try again shortly.',
      429,
      corsHeaders,
      'rate_limited',
    );
  }

  try {
    await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const pairingCode = normalizePairingCode(body?.pairingCode ?? body?.code);
  if (!pairingCode) {
    return errorResponse('pairingCode is required', 400, corsHeaders, 'invalid_code');
  }

  const db = getDb(env);
  const codeHash = await hashToken(pairingCode);
  if (await isPairingPreviewCodeRateLimited(env, codeHash)) {
    return errorResponse(
      'Too many pairing previews for this code. Try again shortly.',
      429,
      corsHeaders,
      'rate_limited',
    );
  }
  const row = await db
    .prepare(`
      SELECT status, expires_at, device_name, device_platform, redeemed_at
      FROM device_pairing_sessions
      WHERE code_hash = ?
      LIMIT 1
    `)
    .bind(codeHash)
    .first();

  if (!row) {
    return errorResponse('Unknown or invalid pairing code', 404, corsHeaders, 'not_found');
  }

  let status = String(row.status || 'pending');
  if (row.redeemed_at) status = 'redeemed';
  else if (status === 'pending' && new Date(row.expires_at) < new Date()) status = 'expired';

  return jsonResponse(
    {
      pairingCode,
      status,
      expiresAt: row.expires_at,
      deviceName: row.device_name ?? null,
      devicePlatform: row.device_platform ?? null,
    },
    200,
    corsHeaders,
  );
}

/**
 * POST /api/auth/device-pairing/complete  body: { pairingCode }
 * Logged-in phone/web approves the pending TV session.
 */
export async function handleDevicePairingComplete(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);

  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const pairingCode = normalizePairingCode(body?.pairingCode ?? body?.code);
  if (!pairingCode) {
    return errorResponse('pairingCode is required', 400, corsHeaders, 'invalid_code');
  }

  const db = getDb(env);
  const codeHash = await hashToken(pairingCode);

  const row = await db
    .prepare(`
      SELECT id, status, expires_at, redeemed_at, device_name, device_platform
      FROM device_pairing_sessions
      WHERE code_hash = ?
      LIMIT 1
    `)
    .bind(codeHash)
    .first();

  if (!row) {
    return errorResponse('Unknown or invalid pairing code', 404, corsHeaders, 'not_found');
  }
  if (row.redeemed_at || row.status === 'redeemed') {
    return errorResponse('Pairing code already used', 409, corsHeaders, 'already_used');
  }
  if (new Date(row.expires_at) < new Date()) {
    await db
      .prepare(
        `UPDATE device_pairing_sessions SET status = 'expired' WHERE id = ? AND status = 'pending'`,
      )
      .bind(row.id)
      .run();
    return errorResponse('Pairing code expired', 410, corsHeaders, 'expired');
  }
  if (row.status !== 'pending') {
    return errorResponse(
      'Pairing code is not awaiting approval',
      409,
      corsHeaders,
      'invalid_status',
    );
  }

  const result = await db
    .prepare(`
      UPDATE device_pairing_sessions
      SET status = 'approved',
          user_id = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending' AND datetime(expires_at) > datetime('now')
    `)
    .bind(user.sub, row.id)
    .run();

  if (!result.meta?.changes) {
    return errorResponse('Pairing code could not be approved', 409, corsHeaders, 'race');
  }

  return jsonResponse(
    {
      ok: true,
      deviceName: row.device_name ?? null,
      devicePlatform: row.device_platform ?? null,
    },
    200,
    corsHeaders,
  );
}

/**
 * POST /api/auth/device-pairing/poll  body: { pairingCode }
 * TV polls until approved, then receives one-shot session tokens.
 */
export async function handleDevicePairingPoll(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);
  if (await isPairingRateLimited(env, 'poll', request)) {
    return errorResponse(
      'Too many pairing polls. Try again shortly.',
      429,
      corsHeaders,
      'rate_limited',
    );
  }

  const body = await request.json().catch(() => null);
  const pairingCode = normalizePairingCode(body?.pairingCode ?? body?.code);
  if (!pairingCode) {
    return errorResponse('pairingCode is required', 400, corsHeaders, 'invalid_code');
  }

  const db = getDb(env);
  const codeHash = await hashToken(pairingCode);

  const row = await db
    .prepare(`
      SELECT s.id, s.status, s.expires_at, s.user_id, s.redeemed_at,
             u.email, u.role, u.totp_enabled, u.created_at
      FROM device_pairing_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.code_hash = ?
      LIMIT 1
    `)
    .bind(codeHash)
    .first();

  if (!row) {
    return errorResponse('Unknown or invalid pairing code', 404, corsHeaders, 'not_found');
  }

  if (row.redeemed_at || row.status === 'redeemed') {
    return errorResponse('Pairing code already used', 409, corsHeaders, 'already_used');
  }

  if (row.status === 'pending') {
    if (new Date(row.expires_at) < new Date()) {
      await db
        .prepare(
          `UPDATE device_pairing_sessions SET status = 'expired' WHERE id = ? AND status = 'pending'`,
        )
        .bind(row.id)
        .run();
      return jsonResponse({ status: 'expired' }, 200, corsHeaders);
    }
    return jsonResponse({ status: 'pending' }, 200, corsHeaders);
  }

  if (row.status === 'expired' || new Date(row.expires_at) < new Date()) {
    return jsonResponse({ status: 'expired' }, 200, corsHeaders);
  }

  if (row.status !== 'approved' || !row.user_id) {
    return errorResponse('Pairing session is not ready', 409, corsHeaders, 'invalid_status');
  }

  const consume = await db
    .prepare(`
      UPDATE device_pairing_sessions
      SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'approved' AND redeemed_at IS NULL
    `)
    .bind(row.id)
    .run();

  if (!consume.meta?.changes) {
    return errorResponse('Pairing code already used', 409, corsHeaders, 'already_used');
  }

  const sessionUser = {
    id: row.user_id,
    email: row.email,
    role: row.role,
    totp_enabled: row.totp_enabled,
    created_at: row.created_at,
  };
  const session = await issueNativeSessionTokens(sessionUser, env, db);

  return jsonResponse({ status: 'ready', ok: true, ...session }, 200, corsHeaders);
}

/**
 * POST /api/push/device  body: { platform, token, deviceId? }
 */
export async function handleNativePushRegister(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);

  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const platform = normalizeNativePushPlatform(body?.platform);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const deviceId =
    typeof body?.deviceId === 'string' && body.deviceId.trim()
      ? body.deviceId.trim().slice(0, 128)
      : null;

  if (!platform) {
    return errorResponse('platform must be ios or android', 400, corsHeaders, 'invalid_platform');
  }
  if (!token) {
    return errorResponse('token is required', 400, corsHeaders, 'invalid_token');
  }
  if (token.length > 4096) {
    return errorResponse('token is too long', 400, corsHeaders, 'token_too_long');
  }

  const db = getDb(env);
  const existing = await db
    .prepare(`SELECT id, user_id FROM native_push_tokens WHERE platform = ? AND token = ? LIMIT 1`)
    .bind(platform, token)
    .first();

  if (existing && existing.user_id !== user.sub) {
    return errorResponse(
      'Push token is already registered to another account',
      409,
      corsHeaders,
      'token_owned',
    );
  }

  if (existing) {
    await db
      .prepare(`
        UPDATE native_push_tokens
        SET device_id = COALESCE(?, device_id),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `)
      .bind(deviceId, existing.id, user.sub)
      .run();
  } else {
    await db
      .prepare(`
        INSERT INTO native_push_tokens (id, user_id, platform, token, device_id, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(crypto.randomUUID(), user.sub, platform, token, deviceId)
      .run();
  }

  return jsonResponse({ ok: true }, 201, corsHeaders);
}

/**
 * DELETE /api/push/device  body (preferred) or query: { token } | { deviceId }
 * Query values are redacted from any URL used in logs.
 */
export async function handleNativePushUnregister(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'DELETE') return errorResponse('Method not allowed', 405, corsHeaders);

  let user: { sub: string };
  try {
    user = await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const url = new URL(request.url);
  const usedQueryFallback = !(
    typeof body?.token === 'string' || typeof body?.deviceId === 'string'
  );
  const token = (
    typeof body?.token === 'string' ? body.token : url.searchParams.get('token') || ''
  ).trim();
  const deviceId = (
    typeof body?.deviceId === 'string' ? body.deviceId : url.searchParams.get('deviceId') || ''
  ).trim();

  if (!token && !deviceId) {
    return errorResponse('token or deviceId is required', 400, corsHeaders);
  }

  const db = getDb(env);
  if (token) {
    await db
      .prepare('DELETE FROM native_push_tokens WHERE user_id = ? AND token = ?')
      .bind(user.sub, token)
      .run();
  } else {
    await db
      .prepare('DELETE FROM native_push_tokens WHERE user_id = ? AND device_id = ?')
      .bind(user.sub, deviceId)
      .run();
  }

  if (usedQueryFallback) {
    log({
      service: 'push',
      event: 'native_push_unregister_query',
      level: 'info',
      http_path: '/api/push/device',
      request_url: redactPushDeviceQuery(request.url),
    });
  }

  return jsonResponse({ ok: true }, 200, corsHeaders);
}
