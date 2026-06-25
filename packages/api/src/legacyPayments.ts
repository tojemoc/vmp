/**
 * Legacy eshop billing — checkout, webhooks, and purchase ID linking for imported users.
 */

import { requireAuth, requireRole } from './auth.js'
import { syncNewsletterForStripeSubscription, removeSubscriberFromNewsletter } from './brevo.js'
import { getSetting } from './settingsStore.js'
import { revokeOfflineLicensesForUser } from './offlineDownloads.js'
import {
  createLegacyOrder,
  getLegacyOrder,
  isLegacyFetchTimeout,
  isLegacyProviderConfigured,
  normalizeLegacySubscriptionStatus,
  processLegacyOrder,
  verifyLegacyWebhookSignature,
} from './legacyProvider.js'

type PlanType = 'monthly' | 'yearly' | 'club'

type LegacyCheckoutRequestBody = {
  planType?: unknown
  returnPath?: unknown
  purchaseId?: unknown
}

type LegacyCompleteRequestBody = {
  orderId?: unknown
  planType?: unknown
}

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function getDb(env: any) {
  return env.DB
}

function normalizePlanType(value: unknown): PlanType {
  const plan = String(value ?? '').trim().toLowerCase()
  if (plan === 'yearly' || plan === 'club') return plan
  return 'monthly'
}

function normalizeReturnPath(raw: unknown, fallback = '/account'): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.length > 1024) return fallback
  return trimmed
}

async function getPlanAmountMinor(env: any, planType: PlanType): Promise<number | null> {
  const key = `legacy_${planType}_price_eur`
  const fallbackKey = `${planType}_price_eur`
  const raw = await getSetting(env, key, { ttlSeconds: 300 })
    ?? await getSetting(env, fallbackKey, { ttlSeconds: 300 })
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.round(numeric * 100)
}

async function upsertLegacySubscription(
  env: any,
  input: {
    userId: string
    planType: PlanType
    status: 'active' | 'trialing' | 'past_due' | 'cancelled'
    purchaseId: string
    providerOrderId: string
    periodEndIso?: string | null
  },
) {
  const db = getDb(env)
  const now = new Date().toISOString()
  const existing = await db.prepare(`
    SELECT id FROM subscriptions
    WHERE user_id = ? AND provider = 'legacy'
    LIMIT 1
  `).bind(input.userId).first()

  if (existing?.id) {
    await db.prepare(`
      UPDATE subscriptions
      SET plan_type = ?, status = ?, purchase_id = ?, provider_subscription_id = ?,
          provider_customer_id = ?, current_period_end = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      input.planType,
      input.status,
      input.purchaseId,
      input.providerOrderId,
      input.purchaseId,
      input.periodEndIso ?? null,
      now,
      existing.id,
    ).run()
    return existing.id
  }

  const id = crypto.randomUUID()
  await db.prepare(`
    INSERT INTO subscriptions (
      id, user_id, plan_type, status, provider, provider_subscription_id,
      provider_customer_id, purchase_id, current_period_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'legacy', ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.userId,
    input.planType,
    input.status,
    input.providerOrderId,
    input.purchaseId,
    input.purchaseId,
    input.periodEndIso ?? null,
    now,
    now,
  ).run()
  return id
}

export async function startLegacyCheckout(
  env: any,
  user: { sub: string, email: string },
  body: { planType?: unknown, returnPath?: unknown, purchaseId?: unknown },
  corsHeaders: Record<string, string>,
) {
  if (!isLegacyProviderConfigured(env)) {
    return jsonResponse({ error: 'Legacy billing is not configured', code: 'legacy_not_configured' }, 503, corsHeaders)
  }

  const planType = normalizePlanType(body?.planType)
  const returnPath = normalizeReturnPath(body?.returnPath)
  const amountMinor = await getPlanAmountMinor(env, planType)
  if (amountMinor == null) {
    return jsonResponse({ error: 'Legacy plan pricing is not configured', code: 'prices_not_configured' }, 503, corsHeaders)
  }

  const db = getDb(env)
  const existingSub = await db.prepare(`
    SELECT id FROM subscriptions
    WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due')
    LIMIT 1
  `).bind(user.sub).first()
  if (existingSub) {
    return jsonResponse({
      error: 'You already have an active subscription.',
      code: 'subscription_exists',
    }, 409, corsHeaders)
  }

  const idOrder = crypto.randomUUID()
  const legacySub = await db.prepare(`
    SELECT purchase_id FROM subscriptions
    WHERE user_id = ? AND provider = 'legacy' AND status = 'needs_relink'
      AND purchase_id IS NOT NULL AND trim(purchase_id) <> ''
    ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
    LIMIT 1
  `).bind(user.sub).first()
  const dbPurchaseId = String(legacySub?.purchase_id ?? '').trim()
  const bodyPurchaseId = String(body?.purchaseId ?? '').trim()
  if (bodyPurchaseId && dbPurchaseId && bodyPurchaseId !== dbPurchaseId) {
    return jsonResponse({
      error: 'purchaseId does not match your account',
      code: 'invalid_purchase_id',
    }, 400, corsHeaders)
  }
  if (bodyPurchaseId && !dbPurchaseId) {
    return jsonResponse({
      error: 'purchaseId cannot be supplied without a matching imported subscription',
      code: 'invalid_purchase_id',
    }, 400, corsHeaders)
  }
  const purchaseId = dbPurchaseId || idOrder
  const frontendUrl = String(env.FRONTEND_URL ?? '').trim().replace(/\/$/, '')
  if (!frontendUrl) {
    return jsonResponse({ error: 'FRONTEND_URL is not configured', code: 'misconfigured' }, 503, corsHeaders)
  }
  const returnUrl = `${frontendUrl}${returnPath}?legacy_order=${encodeURIComponent(idOrder)}`

  try {
    const created = await createLegacyOrder(env, {
      idOrder,
      purchaseId,
      email: user.email,
      planType,
      amountMinor,
      currency: 'EUR',
      returnUrl,
    }) as Record<string, unknown>

    await db.prepare(`
      INSERT INTO payment_checkout_sessions (
        id, user_id, provider, plan_type, checkout_token, provider_checkout_id, status, created_at, updated_at
      ) VALUES (?, ?, 'legacy', ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(crypto.randomUUID(), user.sub, planType, idOrder, idOrder).run()

    const checkoutUrl = String(
      created.webPaymentGatewayLink ||
      created.gatewayLink ||
      created.paymentUrl ||
      created.checkoutUrl ||
      created.redirectUrl ||
      created.returnUrl ||
      '',
    ).trim()
    if (checkoutUrl) {
      return jsonResponse({ checkoutUrl, provider: 'legacy', orderId: idOrder }, 200, corsHeaders)
    }

    await processLegacyOrder(env, idOrder)
    const processed = await getLegacyOrder(env, idOrder) as Record<string, unknown>
    const payUrl = String(
      processed.webPaymentGatewayLink ||
      processed.gatewayLink ||
      processed.paymentUrl ||
      processed.checkoutUrl ||
      processed.redirectUrl ||
      processed.returnUrl ||
      '',
    ).trim()
    return jsonResponse({
      checkoutUrl: payUrl || returnUrl,
      provider: 'legacy',
      orderId: idOrder,
    }, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Legacy checkout failed'
    const code = isLegacyFetchTimeout(err) ? 'legacy_timeout' : 'legacy_checkout_failed'
    const status = isLegacyFetchTimeout(err) ? 504 : 502
    return jsonResponse({ error: message, code }, status, corsHeaders)
  }
}

export async function handleLegacyCheckout(request: Request, env: any, corsHeaders: Record<string, string>) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  const body = (await request.json().catch(() => ({}))) as LegacyCheckoutRequestBody
  return startLegacyCheckout(env, user, body, corsHeaders)
}

export async function handleLegacyComplete(request: Request, env: any, corsHeaders: Record<string, string>) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const body = (await request.json().catch(() => null)) as LegacyCompleteRequestBody | null
  const orderId = String(body?.orderId ?? '').trim()
  if (!orderId) {
    return jsonResponse({ error: 'orderId is required' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const session = await db.prepare(`
    SELECT id, user_id, plan_type, status
    FROM payment_checkout_sessions
    WHERE provider = 'legacy' AND provider_checkout_id = ? AND user_id = ?
    LIMIT 1
  `).bind(orderId, user.sub).first()
  if (!session) {
    return jsonResponse({ error: 'Order not found for this account', code: 'order_not_found' }, 403, corsHeaders)
  }

  try {
    const order = await getLegacyOrder(env, orderId) as Record<string, unknown>
    const status = normalizeLegacySubscriptionStatus(order.status ?? order.subscriptionStatus)
    const purchaseId = String(order.purchaseId ?? order.purchase_id ?? orderId).trim()
    const planType = normalizePlanType(order.planType ?? body?.planType ?? (session as any).plan_type)
    const periodEnd = order.currentPeriodEnd ?? order.current_period_end ?? null

    await upsertLegacySubscription(env, {
      userId: user.sub,
      planType,
      status,
      purchaseId,
      providerOrderId: orderId,
      periodEndIso: periodEnd ? String(periodEnd) : null,
    })

    await db.prepare(`
      UPDATE payment_checkout_sessions
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind((session as any).id).run()

    try {
      await syncNewsletterForStripeSubscription(db, user.sub, status, env)
    } catch (brevoErr) {
      console.error('[legacy complete] syncNewsletterForStripeSubscription failed', brevoErr)
    }

    return jsonResponse({ ok: true, status, purchaseId }, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Legacy completion failed'
    const code = isLegacyFetchTimeout(err) ? 'legacy_timeout' : 'legacy_completion_failed'
    const status = isLegacyFetchTimeout(err) ? 504 : 502
    return jsonResponse({ error: message, code }, status, corsHeaders)
  }
}

export async function handleLegacyOrderStatus(request: Request, env: any, corsHeaders: Record<string, string>) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const url = new URL(request.url)
  const orderId = String(url.searchParams.get('orderId') ?? '').trim()
  if (!orderId) {
    return jsonResponse({ error: 'orderId is required' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const session = await db.prepare(`
    SELECT id, plan_type, status, created_at, completed_at
    FROM payment_checkout_sessions
    WHERE provider = 'legacy' AND provider_checkout_id = ? AND user_id = ?
    LIMIT 1
  `).bind(orderId, user.sub).first()
  if (!session) {
    return jsonResponse({ error: 'Order not found for this account', code: 'order_not_found' }, 403, corsHeaders)
  }

  try {
    const order = await getLegacyOrder(env, orderId) as Record<string, unknown>
    const normalizedStatus = normalizeLegacySubscriptionStatus(order.status ?? order.subscriptionStatus)
    return jsonResponse({
      orderId,
      sessionStatus: (session as any).status ?? null,
      planType: (session as any).plan_type ?? null,
      providerStatus: order.status ?? order.subscriptionStatus ?? null,
      normalizedStatus,
      createdAt: (session as any).created_at ?? null,
      completedAt: (session as any).completed_at ?? null,
    }, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch order status'
    const code = isLegacyFetchTimeout(err) ? 'legacy_timeout' : 'legacy_status_failed'
    const status = isLegacyFetchTimeout(err) ? 504 : 502
    return jsonResponse({ error: message, code }, status, corsHeaders)
  }
}

export async function handleLegacyWebhook(request: Request, env: any, corsHeaders: Record<string, string>) {
  const rawBody = await request.text()
  const signature = request.headers.get('X-Legacy-Signature')
    ?? request.headers.get('X-Webhook-Signature')
    ?? request.headers.get('Authorization')

  if (!await verifyLegacyWebhookSignature(env, rawBody, signature)) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 401, corsHeaders)
  }

  let payload: Record<string, unknown>
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders)
  }

  const purchaseId = String(payload.purchaseId ?? payload.purchase_id ?? '').trim()
  if (!purchaseId) {
    return jsonResponse({ error: 'purchaseId is required' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const sub = await db.prepare(`
    SELECT s.id, s.user_id, s.plan_type
    FROM subscriptions s
    WHERE s.purchase_id = ? OR s.provider_subscription_id = ? OR s.provider_customer_id = ?
    LIMIT 1
  `).bind(purchaseId, purchaseId, purchaseId).first()

  if (!sub) {
    return jsonResponse({ ok: true, skipped: true, reason: 'subscription_not_found' }, 200, corsHeaders)
  }

  const status = normalizeLegacySubscriptionStatus(payload.status ?? payload.subscriptionStatus)
  const planType = normalizePlanType(payload.planType ?? (sub as any).plan_type)
  const periodEnd = payload.currentPeriodEnd ?? payload.current_period_end ?? null
  const orderId = String(payload.idOrder ?? payload.orderId ?? purchaseId).trim()

  await upsertLegacySubscription(env, {
    userId: String((sub as any).user_id),
    planType,
    status,
    purchaseId,
    providerOrderId: orderId,
    periodEndIso: periodEnd ? String(periodEnd) : null,
  })

  try {
    await syncNewsletterForStripeSubscription(db, String((sub as any).user_id), status, env)
  } catch (brevoErr) {
    console.error('[legacy webhook] syncNewsletterForStripeSubscription failed', brevoErr)
  }

  const userId = String((sub as any).user_id)
  if (status === 'cancelled' || status === 'past_due') {
    try {
      await removeSubscriberFromNewsletter(db, userId, env)
    } catch (brevoErr) {
      console.error('[legacy webhook] removeSubscriberFromNewsletter failed', brevoErr)
    }
    try {
      await revokeOfflineLicensesForUser(
        db,
        userId,
        status === 'cancelled' ? 'subscription_cancelled' : 'subscription_past_due',
      )
    } catch (offlineErr) {
      console.error('[legacy webhook] revokeOfflineLicensesForUser failed', offlineErr)
    }
  }

  return jsonResponse({ ok: true }, 200, corsHeaders)
}

export async function handleAdminLegacyPaymentSettings(request: Request, env: any, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method === 'GET') {
    const url = new URL(request.url)
    if (url.searchParams.get('orders') === '1') {
      const limitRaw = Number.parseInt(String(url.searchParams.get('limit') ?? '25'), 10)
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 25
      const db = getDb(env)
      const rows = await db.prepare(`
        SELECT pcs.id, pcs.user_id, pcs.plan_type, pcs.provider_checkout_id, pcs.status,
               pcs.created_at, pcs.completed_at, u.email
        FROM payment_checkout_sessions pcs
        LEFT JOIN users u ON u.id = pcs.user_id
        WHERE pcs.provider = 'legacy'
        ORDER BY datetime(COALESCE(pcs.updated_at, pcs.created_at)) DESC
        LIMIT ?
      `).bind(limit).all()
      const orders = (rows.results ?? []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email ? maskEmail(String(row.email)) : null,
        planType: row.plan_type,
        orderId: row.provider_checkout_id,
        status: row.status,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }))
      return jsonResponse({ orders }, 200, corsHeaders)
    }

    return jsonResponse({
      configured: isLegacyProviderConfigured(env, 'production'),
      sandboxConfigured: isLegacyProviderConfigured(env, 'sandbox'),
      merchantId: String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim() || null,
      hasApiKey: Boolean(String(env.LEGACY_ESHOP_API_KEY ?? '').trim()),
      hasWebhookSecret: Boolean(String(env.LEGACY_ESHOP_WEBHOOK_SECRET ?? '').trim()),
    }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const visible = local.length <= 2 ? local[0] ?? '*' : `${local.slice(0, 2)}***`
  return `${visible}@${domain}`
}
