/**
 * PWA push-login flow: anonymous push subscription delivers a handoff code
 * after the user confirms in Safari (magic link with ?pwa=1).
 */

import {
  generateToken,
  hashToken,
  consumeMagicLinkForUser,
} from './auth.js'
import { sendPushNotification } from './webpush.js'

const PWA_PUSH_LOGIN_TTL_SEC = 15 * 60
const PWA_MAGIC_HANDOFF_TTL_SEC = 600

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function authJson(data: any, status: number, corsHeaders: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  })
}

async function cleanupExpiredPushLoginAttempts(db: any) {
  await db
    .prepare("DELETE FROM pwa_push_login_attempts WHERE datetime(expires_at) < datetime('now')")
    .run()
}

async function rateLimitByIp(request: any, env: any, keyPrefix: string, maxPerHour: number): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV
  if (!kv) return false
  try {
    const ip = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown'
    const hourBucket = Math.floor(Date.now() / 3_600_000)
    const fingerprint = await hashToken(`${keyPrefix}:${ip}:${hourBucket}`)
    const key = `auth:pwa-push-login:${fingerprint}`
    const currentRaw = await kv.get(key)
    const current = Number.parseInt(currentRaw ?? '0', 10)
    const count = Number.isFinite(current) ? current : 0
    if (count >= maxPerHour) return true
    await kv.put(key, String(count + 1), { expirationTtl: 7200 })
    return false
  } catch {
    return false
  }
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '127.0.0.1' || h.startsWith('127.')) return true
  if (h === '::1' || h === '[::1]') return true
  const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!ipv4) return false
  const a = Number(ipv4[1])
  const b = Number(ipv4[2])
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  return false
}

function validatePushSubscriptionBody(body: any): { endpoint: string; p256dh: string; auth: string } | null {
  const sub = body?.subscription ?? body
  if (
    typeof sub?.endpoint !== 'string' ||
    typeof sub?.keys?.p256dh !== 'string' ||
    typeof sub?.keys?.auth !== 'string'
  ) {
    return null
  }
  let endpointUrl: URL
  try {
    endpointUrl = new URL(sub.endpoint)
  } catch {
    return null
  }
  if (endpointUrl.protocol !== 'https:' || isPrivateHost(endpointUrl.hostname)) {
    return null
  }
  return { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }
}

async function upsertUser(email: string, db: any) {
  const existing = await db
    .prepare('SELECT id, email, role FROM users WHERE email = ?')
    .bind(email)
    .first()
  if (existing) return existing
  const id = crypto.randomUUID()
  await db
    .prepare("INSERT INTO users (id, email, role) VALUES (?, ?, 'viewer')")
    .bind(id, email)
    .run()
  return { id, email, role: 'viewer' }
}

async function createMagicLinkForPwaPushLogin(request: any, email: string, db: any, env: any) {
  const user = await upsertUser(email, db)
  await db
    .prepare('DELETE FROM magic_link_tokens WHERE user_id = ? AND used_at IS NULL')
    .bind(user.id)
    .run()

  const token = generateToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + PWA_PUSH_LOGIN_TTL_SEC * 1000).toISOString()

  await db
    .prepare('INSERT INTO magic_link_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, tokenHash, expiresAt)
    .run()

  return { token, tokenHash, user }
}

async function sendMagicLinkEmail(to: string, verifyUrl: string, env: any) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { email: env.SENDER_EMAIL || 'noreply@example.com', name: env.SENDER_NAME || 'VMP' },
      to: [{ email: to }],
      subject: 'Your sign-in link',
      htmlContent: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="margin:0 0 16px;font-size:22px">Sign in to VMP</h2>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">
            Click the button below to sign in. This link expires in 15 minutes
            and can only be used once.
          </p>
          <a href="${verifyUrl}"
             style="display:inline-block;padding:12px 24px;background:#2563eb;
                    color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
            Sign in
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#999">
            If you didn't request this, you can safely ignore it.
          </p>
        </div>
      `,
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Brevo error (${response.status}): ${text}`)
  }
}

/**
 * POST /api/auth/pwa-push-login/init
 * Body: { email, deviceToken }
 */
export async function handlePwaPushLoginInit(request: any, env: any, corsHeaders: any) {
  if (await rateLimitByIp(request, env, 'init', 5)) {
    return authJson({ error: 'Too many requests. Please try again later.', code: 'rate_limit_exceeded' }, 429, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const deviceToken = typeof body?.deviceToken === 'string' ? body.deviceToken.trim() : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return authJson({ error: 'Invalid email format' }, 400, corsHeaders)
  }
  if (!deviceToken || deviceToken.length > 128) {
    return authJson({ error: 'deviceToken is required' }, 400, corsHeaders)
  }

  const db = getDb(env)
  await cleanupExpiredPushLoginAttempts(db)

  const expiresAt = new Date(Date.now() + PWA_PUSH_LOGIN_TTL_SEC * 1000).toISOString()

  await db
    .prepare(`
      INSERT INTO pwa_push_login_attempts (device_token, email, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(device_token) DO UPDATE SET
        email = excluded.email,
        magic_link_token_hash = NULL,
        push_subscription_json = NULL,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `)
    .bind(deviceToken, email, expiresAt)
    .run()

  return authJson({ ok: true }, 200, corsHeaders)
}

/**
 * POST /api/auth/pwa-push-login/subscribe
 * Body: { deviceToken, subscription: { endpoint, keys: { p256dh, auth } } }
 */
export async function handlePwaPushLoginSubscribe(request: any, env: any, corsHeaders: any) {
  if (await rateLimitByIp(request, env, 'subscribe', 10)) {
    return authJson({ error: 'Too many requests. Please try again later.', code: 'rate_limit_exceeded' }, 429, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const deviceToken = typeof body?.deviceToken === 'string' ? body.deviceToken.trim() : ''
  const keys = validatePushSubscriptionBody(body)

  if (!deviceToken) {
    return authJson({ error: 'deviceToken is required' }, 400, corsHeaders)
  }
  if (!keys) {
    return authJson({ error: 'Invalid push subscription object' }, 400, corsHeaders)
  }

  const db = getDb(env)
  await cleanupExpiredPushLoginAttempts(db)

  const attempt = await db
    .prepare(`
      SELECT device_token, email, expires_at
      FROM pwa_push_login_attempts
      WHERE device_token = ?
    `)
    .bind(deviceToken)
    .first()

  if (!attempt || new Date(attempt.expires_at) < new Date()) {
    return authJson({ error: 'Sign-in session expired. Start again from the app.', code: 'attempt_expired' }, 400, corsHeaders)
  }

  const pushJson = JSON.stringify({
    endpoint: keys.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  })

  let token: string
  let tokenHash: string
  try {
    const created = await createMagicLinkForPwaPushLogin(request, attempt.email, db, env)
    token = created.token
    tokenHash = created.tokenHash
  } catch (err) {
    console.error('[pwa-push-login] magic link creation failed:', err)
    return authJson({ error: 'Could not start sign-in. Try again.' }, 500, corsHeaders)
  }

  await db
    .prepare(`
      UPDATE pwa_push_login_attempts
      SET push_subscription_json = ?, magic_link_token_hash = ?
      WHERE device_token = ?
    `)
    .bind(pushJson, tokenHash, deviceToken)
    .run()

  const frontendUrl = (env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
  const verifyUrl = new URL(`${frontendUrl}/auth/verify`)
  verifyUrl.searchParams.set('token', token)
  verifyUrl.searchParams.set('pwa', '1')

  try {
    if (env.BREVO_API_KEY) {
      await sendMagicLinkEmail(attempt.email, verifyUrl.toString(), env)
    } else {
      console.log(`[DEV] PWA push-login magic link for ${attempt.email}: ${verifyUrl.toString()}`)
    }
  } catch (err) {
    console.error('[pwa-push-login] email send failed:', err)
    return authJson({ error: 'Could not send sign-in email. Try again.' }, 500, corsHeaders)
  }

  return authJson({ ok: true, emailSent: true }, 200, corsHeaders)
}

/**
 * POST /api/auth/pwa-push-login/deliver
 * Body: { token }
 */
export async function handlePwaPushLoginDeliver(request: any, env: any, corsHeaders: any) {
  if (await rateLimitByIp(request, env, 'deliver', 20)) {
    return authJson({ error: 'Too many requests. Please try again later.', code: 'rate_limit_exceeded' }, 429, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const rawToken = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!rawToken) {
    return authJson({ error: 'token is required' }, 400, corsHeaders)
  }

  const tokenHash = await hashToken(rawToken)
  const db = getDb(env)
  await cleanupExpiredPushLoginAttempts(db)

  const linkRow = await db
    .prepare(`
      SELECT t.id, t.expires_at, t.used_at
      FROM magic_link_tokens t
      WHERE t.token_hash = ?
    `)
    .bind(tokenHash)
    .first()

  if (!linkRow || linkRow.used_at) {
    return authJson({ error: 'Sign-in link is invalid or has already been used.' }, 401, corsHeaders)
  }
  if (new Date(linkRow.expires_at) < new Date()) {
    return authJson({ error: 'Sign-in link has expired. Request a new one.' }, 401, corsHeaders)
  }

  const attempt = await db
    .prepare(`
      SELECT device_token, push_subscription_json, expires_at
      FROM pwa_push_login_attempts
      WHERE magic_link_token_hash = ?
    `)
    .bind(tokenHash)
    .first()

  if (!attempt?.push_subscription_json || new Date(attempt.expires_at) < new Date()) {
    if (attempt?.device_token) {
      await db.prepare('DELETE FROM pwa_push_login_attempts WHERE device_token = ?').bind(attempt.device_token).run()
    }
    return authJson({ ok: false, code: 'no_push_subscription' }, 200, corsHeaders)
  }

  const phase = await consumeMagicLinkForUser(env, rawToken)
  if (phase.tag === 'invalid') {
    return authJson({ error: phase.message }, 401, corsHeaders)
  }
  if (phase.tag === 'totp_pending') {
    return authJson({ requiresTwoFactor: true, pendingToken: phase.pendingToken }, 200, corsHeaders)
  }

  let pushSub: { endpoint: string; keys: { p256dh: string; auth: string } }
  try {
    pushSub = JSON.parse(attempt.push_subscription_json)
  } catch {
    await db.prepare('DELETE FROM pwa_push_login_attempts WHERE device_token = ?').bind(attempt.device_token).run()
    return authJson({ ok: false, code: 'no_push_subscription' }, 200, corsHeaders)
  }

  const validated = validatePushSubscriptionBody({ subscription: pushSub })
  if (!validated) {
    await db.prepare('DELETE FROM pwa_push_login_attempts WHERE device_token = ?').bind(attempt.device_token).run()
    return authJson({ ok: false, code: 'no_push_subscription' }, 200, corsHeaders)
  }

  const handoffCode = generateToken()
  const codeHash = await hashToken(handoffCode)
  const handoffExpiresAt = new Date(Date.now() + PWA_MAGIC_HANDOFF_TTL_SEC * 1000).toISOString()

  try {
    await db
      .prepare('INSERT INTO pwa_handoffs (code, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(codeHash, phase.user.id, handoffExpiresAt)
      .run()
  } catch (err) {
    console.error('[pwa-push-login] handoff insert failed:', err)
    return authJson({ error: 'Could not complete sign-in. Try again.' }, 500, corsHeaders)
  }

  try {
    await sendPushNotification(
      {
        endpoint: validated.endpoint,
        p256dh: validated.p256dh,
        auth: validated.auth,
      },
      {
        type: 'pwa_auth',
        handoffCode,
        title: 'Tap to sign in',
        body: 'Your sign-in is ready',
      },
      env,
    )
  } catch (err) {
    console.error('[pwa-push-login] push delivery failed:', err)
    return authJson({ ok: false, code: 'push_failed' }, 200, corsHeaders)
  }

  await db
    .prepare('DELETE FROM pwa_push_login_attempts WHERE device_token = ?')
    .bind(attempt.device_token)
    .run()

  return authJson({ ok: true, delivered: true }, 200, corsHeaders)
}
