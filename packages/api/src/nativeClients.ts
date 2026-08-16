/**
 * Native / TV client auth helpers — device pairing + APNs/FCM token register.
 * See docs/native-clients-plan.md (Phase 0).
 */

import type { NativePushPlatform } from '@vmp/shared';
import { hashToken, issueNativeSessionTokens, requireAuth } from './auth.js';

const PAIRING_TTL_SEC = 10 * 60;
const PAIRING_POLL_INTERVAL_SEC = 2;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db;
  if (!db) throw new Error('D1 binding not found');
  return db;
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
 */
export async function handleDevicePairingStart(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);

  const db = getDb(env);
  const pairingCode = generatePairingCode();
  const codeHash = await hashToken(pairingCode);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000).toISOString();

  await db
    .prepare(`
      INSERT INTO device_pairing_sessions (id, code_hash, status, expires_at)
      VALUES (?, ?, 'pending', ?)
    `)
    .bind(id, codeHash, expiresAt)
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
      SELECT id, status, expires_at, redeemed_at
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

  return jsonResponse({ ok: true }, 200, corsHeaders);
}

/**
 * POST /api/auth/device-pairing/poll  body: { pairingCode }
 * TV polls until approved, then receives one-shot session tokens.
 */
export async function handleDevicePairingPoll(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405, corsHeaders);

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
  if (!token || token.length > 4096) {
    return errorResponse('token is required', 400, corsHeaders, 'invalid_token');
  }

  const db = getDb(env);
  const id = crypto.randomUUID();

  await db
    .prepare(`
      INSERT INTO native_push_tokens (id, user_id, platform, token, device_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform, token) DO UPDATE SET
        user_id = excluded.user_id,
        device_id = COALESCE(excluded.device_id, native_push_tokens.device_id),
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(id, user.sub, platform, token, deviceId)
    .run();

  return jsonResponse({ ok: true }, 201, corsHeaders);
}

/**
 * DELETE /api/push/device  body: { token } | { deviceId }
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
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';

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

  return jsonResponse({ ok: true }, 200, corsHeaders);
}
