/**
 * Provider-agnostic payments orchestration (Stripe + GoCardless).
 */

import { requireAuth, requireRole } from './auth.js'
import { isAdministrativeRole } from './roles.js'
import { getSetting, setSettings } from './settingsStore.js'
import {
  removeSubscriberFromNewsletter,
  syncNewsletterForStripeSubscription,
} from './brevo.js'
import {
  applyPromoRedemption,
  resolvePromoCodeForCheckout,
} from './promotions.js'
import {
  normalizeStripeStatus,
  stripeGet,
  stripePost,
  stripeSubscriptionPeriodEndIso,
  verifyStripeWebhook,
} from './stripeClient.js'
export { normalizeStripeStatus } from './stripeClient.js'
import { isLegacyProviderConfigured } from './legacyProvider.js'
import { startLegacyCheckout } from './legacyPayments.js'
import {
  buildGoCardlessBillingRequestFlowCreatePayload,
  buildGoCardlessMandateBillingRequestPayload,
  formatGoCardlessApiError,
  gocardlessGet,
  gocardlessPost,
  getGoCardlessInterval,
  normalizeGoCardlessCurrency,
  normalizeGoCardlessStatus,
  prefillGoCardlessBillingRequestCustomer,
  resolveFulfilledBillingRequestMandate,
  verifyGoCardlessWebhook,
} from './gocardlessCore.js'
export { normalizeGoCardlessStatus } from './gocardlessCore.js'

type PlanType = 'monthly' | 'yearly' | 'club'
type PaymentProvider = 'stripe' | 'gocardless' | 'legacy'
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled'

async function getAllowedPlans(env: any): Promise<PlanType[]> {
  const raw = String(await getSetting(env, 'allowed_plans', { defaultValue: 'monthly,yearly,club' }) ?? 'monthly,yearly,club')
  const plans = raw
    .split(',')
    .map((v: string) => v.trim().toLowerCase())
    .filter((v: string): v is PlanType => v === 'monthly' || v === 'yearly' || v === 'club')
  return plans.length > 0 ? plans : ['monthly', 'yearly', 'club']
}

async function getPaymentProviderOrder(env: any): Promise<PaymentProvider[]> {
  const stored = await getSetting(env, 'payment_provider_order', { defaultValue: 'stripe,legacy' })
  const raw = String(stored ?? 'stripe,legacy').trim()
  const providers = (raw ? raw : 'stripe,legacy')
    .split(',')
    .map((v: string) => v.trim().toLowerCase())
    .filter((v: string): v is PaymentProvider => v === 'stripe' || v === 'gocardless' || v === 'legacy')
  return providers.length > 0 ? providers : ['stripe']
}

/** Gateways enabled for new checkouts. GoCardless removed from user-facing checkout; legacy optional. */
async function getConfiguredProviders(env: any): Promise<PaymentProvider[]> {
  const stored = await getSetting(env, 'payments_enabled_providers', { defaultValue: 'stripe' })
  const raw = String(stored ?? 'stripe').trim()
  let configured = (raw ? raw : 'stripe')
    .split(',')
    .map((v: string) => v.trim().toLowerCase())
    .filter((v: string): v is PaymentProvider => v === 'stripe' || v === 'legacy')
  if (configured.length === 0) configured = ['stripe']
  return configured
}

/** Gateways that can actually run checkout in this environment (requires provider credentials). */
async function getRunnableProviders(env: any): Promise<PaymentProvider[]> {
  const configured = await getConfiguredProviders(env)
  const available = configured.filter((provider) => {
    if (provider === 'stripe') return Boolean(env.STRIPE_SECRET_KEY)
    if (provider === 'legacy') return isLegacyProviderConfigured(env)
    return false
  })
  if (available.length > 0) return available
  return Boolean(env.STRIPE_SECRET_KEY) ? ['stripe'] : []
}

function parseConfiguredPrice(value: unknown): number | null {
  if (value === '' || value == null) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

async function getPricingSettings(env: any, provider?: PaymentProvider) {
  const prefix = provider ? `${provider}_` : ''
  const [monthly, yearly, club] = await Promise.all([
    getSetting(env, `${prefix}monthly_price_eur`, { ttlSeconds: 300 }),
    getSetting(env, `${prefix}yearly_price_eur`, { ttlSeconds: 300 }),
    getSetting(env, `${prefix}club_price_eur`, { ttlSeconds: 300 }),
  ])
  return {
    monthly: parseConfiguredPrice(monthly),
    yearly: parseConfiguredPrice(yearly),
    club: parseConfiguredPrice(club),
  }
}

async function getEffectivePricingSettings(env: any, provider: PaymentProvider) {
  const [providerPricing, fallbackPricing] = await Promise.all([
    getPricingSettings(env, provider),
    getPricingSettings(env),
  ])
  return {
    monthly: providerPricing.monthly ?? fallbackPricing.monthly,
    yearly: providerPricing.yearly ?? fallbackPricing.yearly,
    club: providerPricing.club ?? fallbackPricing.club,
  }
}

function moneyToMinorUnits(amount: number) {
  return Math.max(0, Math.round(amount * 100))
}

// ─── D1 / admin_settings helpers ─────────────────────────────────────────────

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

/**
 * Resolve plan_type ('monthly'|'yearly'|'club') from a Stripe price ID
 * by comparing against the price IDs stored in admin_settings.
 */
async function resolvePlanType(db: any, stripePriceId: any, env: any): Promise<PlanType> {
  const keys = ['stripe_price_monthly', 'stripe_price_yearly', 'stripe_price_club'] as const
  const planNames: PlanType[] = ['monthly', 'yearly', 'club']
  for (let i = 0; i < keys.length; i++) {
    const stored = await getSetting(env, keys[i], { ttlSeconds: 300 })
    if (stored && stored === stripePriceId) return planNames[i] ?? 'monthly'
  }
  return 'monthly' // fallback
}

function normalizePlanType(planType: string): PlanType {
  if (planType === 'yearly' || planType === 'club') return planType
  return 'monthly'
}

async function upsertSubscriptionRow(
  db: any,
  params: {
    userId: string
    planType: PlanType
    status: SubscriptionStatus
    provider: PaymentProvider
    providerSubscriptionId: string | null
    providerCustomerId: string | null
    stripeSubscriptionId?: string | null
    stripeCustomerId?: string | null
    currentPeriodEnd?: string | null
  },
) {
  await db.prepare(`
    INSERT INTO subscriptions
      (
        id,
        user_id,
        plan_type,
        status,
        provider,
        provider_subscription_id,
        provider_customer_id,
        stripe_subscription_id,
        stripe_customer_id,
        current_period_end,
        updated_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
      user_id                  = excluded.user_id,
      status                   = excluded.status,
      plan_type                = excluded.plan_type,
      provider_customer_id     = excluded.provider_customer_id,
      stripe_subscription_id   = excluded.stripe_subscription_id,
      stripe_customer_id       = excluded.stripe_customer_id,
      current_period_end       = excluded.current_period_end,
      updated_at               = CURRENT_TIMESTAMP
  `).bind(
    crypto.randomUUID(),
    params.userId,
    params.planType,
    params.status,
    params.provider,
    params.providerSubscriptionId,
    params.providerCustomerId,
    params.stripeSubscriptionId ?? null,
    params.stripeCustomerId ?? null,
    params.currentPeriodEnd ?? null,
  ).run()
}

async function upsertStripeSubscription(db: any, userId: string, stripeSub: any, env: any) {
  const priceId = stripeSub.items?.data?.[0]?.price?.id ?? null
  const planType = priceId ? await resolvePlanType(db, priceId, env ?? {}) : 'monthly'
  const status = normalizeStripeStatus(stripeSub.status)
  const currentPeriodEnd = stripeSubscriptionPeriodEndIso(stripeSub)

  await upsertSubscriptionRow(db, {
    userId,
    planType: normalizePlanType(planType),
    status,
    provider: 'stripe',
    providerSubscriptionId: stripeSub.id ?? null,
    providerCustomerId: stripeSub.customer ?? null,
    stripeSubscriptionId: stripeSub.id ?? null,
    stripeCustomerId: stripeSub.customer ?? null,
    currentPeriodEnd,
  })
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/account/pricing — PUBLIC
 * Returns the display prices (EUR) from admin_settings.
 */
export async function handleGetPricing(request: any, env: any, corsHeaders: any) {
  try {
    const stripePricing = await getEffectivePricingSettings(env, 'stripe')
    const pricingNotConfigured = stripePricing.monthly == null || stripePricing.yearly == null || stripePricing.club == null
    const payload = {
      monthly: stripePricing.monthly,
      yearly: stripePricing.yearly,
      club: stripePricing.club,
      pricesByProvider: {
        stripe: stripePricing,
      },
      enabledProviders: ['stripe'],
      ...(pricingNotConfigured ? { pricing_not_configured: true } : {}),
    }
    return jsonResponse(payload, 200, corsHeaders)
  } catch (err) {
    console.error('handleGetPricing error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

function parseCsvList(input: unknown, allowValues: string[]) {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim().toLowerCase()).filter((v) => allowValues.includes(v))
  }
  return String(input ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => allowValues.includes(v))
}

function parseOptionalPositiveNumber(input: unknown) {
  if (input === '' || input == null) return ''
  const numeric = Number(input)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Prices must be positive numbers')
  }
  return String(numeric)
}

export async function handleAdminPaymentSettings(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method === 'GET') {
    const keys = [
      'payments_enabled_providers',
      'payment_provider_order',
      'allowed_plans',
      'monthly_price_eur',
      'yearly_price_eur',
      'club_price_eur',
      'stripe_monthly_price_eur',
      'stripe_yearly_price_eur',
      'stripe_club_price_eur',
      'gocardless_monthly_price_eur',
      'gocardless_yearly_price_eur',
      'gocardless_club_price_eur',
      'stripe_price_monthly',
      'stripe_price_yearly',
      'stripe_price_club',
    ] as const
    const values = await Promise.all(keys.map((key) => getSetting(env, key)))
    const valueByKey = Object.fromEntries(keys.map((key, index) => [key, values[index]]))
    return jsonResponse({
      enabledProviders: parseCsvList(valueByKey.payments_enabled_providers ?? 'stripe', ['stripe', 'gocardless']),
      providerOrder: parseCsvList(valueByKey.payment_provider_order ?? 'stripe,gocardless', ['stripe', 'gocardless']),
      allowedPlans: parseCsvList(valueByKey.allowed_plans ?? 'monthly,yearly,club', ['monthly', 'yearly', 'club']),
      basePrices: {
        monthly: valueByKey.monthly_price_eur ?? '',
        yearly: valueByKey.yearly_price_eur ?? '',
        club: valueByKey.club_price_eur ?? '',
      },
      providerPrices: {
        stripe: {
          monthly: valueByKey.stripe_monthly_price_eur ?? '',
          yearly: valueByKey.stripe_yearly_price_eur ?? '',
          club: valueByKey.stripe_club_price_eur ?? '',
        },
        gocardless: {
          monthly: valueByKey.gocardless_monthly_price_eur ?? '',
          yearly: valueByKey.gocardless_yearly_price_eur ?? '',
          club: valueByKey.gocardless_club_price_eur ?? '',
        },
      },
      stripePriceIds: {
        monthly: valueByKey.stripe_price_monthly ?? '',
        yearly: valueByKey.stripe_price_yearly ?? '',
        club: valueByKey.stripe_price_club ?? '',
      },
    }, 200, corsHeaders)
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

    const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Request body is required' }, 400, corsHeaders)
  }

  try {
    const enabledProviders = parseCsvList(body.enabledProviders ?? 'stripe', ['stripe', 'gocardless', 'legacy'])
    if (!enabledProviders.length) {
      return jsonResponse({ error: 'At least one payment provider must be enabled' }, 400, corsHeaders)
    }
    const providerOrder = parseCsvList(body.providerOrder ?? enabledProviders, ['stripe', 'gocardless', 'legacy'])
    const allowedPlans = parseCsvList(body.allowedPlans ?? 'monthly,yearly,club', ['monthly', 'yearly', 'club'])
    const basePrices = body.basePrices ?? {}
    const providerPrices = body.providerPrices ?? {}
    const stripePriceIds = body.stripePriceIds ?? {}

    const updates: [string, string][] = [
      ['payments_enabled_providers', enabledProviders.join(',')],
      ['payment_provider_order', providerOrder.join(',')],
      ['allowed_plans', (allowedPlans.length ? allowedPlans : ['monthly', 'yearly', 'club']).join(',')],
      ['monthly_price_eur', parseOptionalPositiveNumber(basePrices.monthly)],
      ['yearly_price_eur', parseOptionalPositiveNumber(basePrices.yearly)],
      ['club_price_eur', parseOptionalPositiveNumber(basePrices.club)],
      ['stripe_monthly_price_eur', parseOptionalPositiveNumber(providerPrices?.stripe?.monthly)],
      ['stripe_yearly_price_eur', parseOptionalPositiveNumber(providerPrices?.stripe?.yearly)],
      ['stripe_club_price_eur', parseOptionalPositiveNumber(providerPrices?.stripe?.club)],
      ['gocardless_monthly_price_eur', parseOptionalPositiveNumber(providerPrices?.gocardless?.monthly)],
      ['gocardless_yearly_price_eur', parseOptionalPositiveNumber(providerPrices?.gocardless?.yearly)],
      ['gocardless_club_price_eur', parseOptionalPositiveNumber(providerPrices?.gocardless?.club)],
      ['stripe_price_monthly', String(stripePriceIds.monthly ?? '').trim()],
      ['stripe_price_yearly', String(stripePriceIds.yearly ?? '').trim()],
      ['stripe_price_club', String(stripePriceIds.club ?? '').trim()],
    ]

    await setSettings(env, updates)
    return jsonResponse({ ok: true }, 200, corsHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid settings'
    return jsonResponse({ error: message }, 400, corsHeaders)
  }
}

function normalizeReturnPath(input: unknown, fallback = '/account'): string {
  const raw = String(input ?? fallback).trim()
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//')) return fallback
  const [beforeHash = ''] = raw.split('#')
  const [pathOnly = ''] = beforeHash.split('?')
  return pathOnly || fallback
}

/**
 * GET /api/payments/stripe-config — PUBLIC
 * Returns the Stripe publishable key for client-side Elements.
 */
export async function handleGetStripeConfig(_request: any, env: any, corsHeaders: any) {
  const publishableKey = String(env.STRIPE_PUBLISHABLE_KEY ?? '').trim()
  if (!publishableKey) {
    return jsonResponse({
      error: 'Stripe is not configured on the server.',
      code: 'stripe_not_configured',
    }, 503, corsHeaders)
  }
  return jsonResponse({ publishableKey }, 200, corsHeaders)
}

/**
 * GET /api/payments/session-status?session_id=cs_... — protected
 * Returns Checkout Session status after embedded checkout return.
 */
export async function handleSessionStatus(request: any, env: any, corsHeaders: any) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const url = new URL(request.url)
  const sessionId = String(url.searchParams.get('session_id') ?? '').trim()
  if (!sessionId.startsWith('cs_')) {
    return jsonResponse({ error: 'session_id is required' }, 400, corsHeaders)
  }

  try {
    const session = await stripeGet(
      `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent&expand[]=subscription`,
      env,
    )
    if (session.error) {
      console.error('Stripe session retrieve error:', session.error)
      return jsonResponse({ error: 'Failed to retrieve checkout session' }, 502, corsHeaders)
    }

    const sessionUserId = String(session.metadata?.userId ?? '').trim()
    if (!sessionUserId || sessionUserId !== user.sub) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders)
    }

    const paymentIntent = session.payment_intent && typeof session.payment_intent === 'object'
      ? session.payment_intent
      : null
    const subscription = session.subscription && typeof session.subscription === 'object'
      ? session.subscription
      : null

    return jsonResponse({
      status: session.status ?? null,
      paymentStatus: session.payment_status ?? null,
      paymentIntentId: paymentIntent?.id ?? null,
      paymentIntentStatus: paymentIntent?.status ?? null,
      subscriptionId: subscription?.id ?? (typeof session.subscription === 'string' ? session.subscription : null),
      subscriptionStatus: subscription?.status ?? null,
    }, 200, corsHeaders)
  } catch (err) {
    console.error('handleSessionStatus error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * POST /api/payments/checkout — protected
 * Body: { planType: 'monthly'|'yearly'|'club', provider?, promoCode?, returnPath? }
 * Stripe: embedded Checkout Session (ui_mode elements) → { clientSecret }.
 * GoCardless: hosted redirect → { checkoutUrl }.
 */
export async function handleCheckout(request: any, env: any, corsHeaders: any) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const allowedPlans = await getAllowedPlans(env)
  if (!body?.planType || !allowedPlans.includes(body.planType)) {
    return jsonResponse({ error: `planType must be one of: ${allowedPlans.join(', ')}` }, 400, corsHeaders)
  }
  const planType = normalizePlanType(body.planType)

  try {
    const db = getDb(env)
    const configuredProviders = await getConfiguredProviders(env)
    const runnableProviders = await getRunnableProviders(env)
    const providerOrder = await getPaymentProviderOrder(env)
    const orderedRunnable = [
      ...providerOrder.filter((p) => runnableProviders.includes(p)),
      ...runnableProviders.filter((p) => !providerOrder.includes(p)),
    ]
    const defaultProvider: PaymentProvider = orderedRunnable[0] ?? 'stripe'
    const selectedProvider = String(body?.provider ?? '').trim().toLowerCase() as PaymentProvider
    const provider: PaymentProvider = selectedProvider && providerOrder.includes(selectedProvider)
      ? selectedProvider
      : defaultProvider

    const promoResolution = provider === 'stripe'
      ? await resolvePromoCodeForCheckout(env, body?.promoCode, planType, 'stripe')
      : { ok: false, reason: 'empty' }
    const promoMeta = promoResolution.ok ? promoResolution.checkoutMeta : null
    if (!promoResolution.ok && promoResolution.reason !== 'empty') {
      return jsonResponse({
        error: promoResolution.error ?? 'Promo code is not valid',
        code: promoResolution.reason ?? 'invalid_promo',
      }, promoResolution.status ?? 400, corsHeaders)
    }

    if (!configuredProviders.includes(provider)) {
      return jsonResponse({
        error: 'Requested payment provider is not enabled.',
        code: 'provider_not_enabled',
      }, 400, corsHeaders)
    }
    if (!runnableProviders.includes(provider)) {
      return jsonResponse({
        error: 'This payment provider is enabled in settings but is not configured on the server (missing API credentials).',
        code: 'provider_not_configured',
      }, 503, corsHeaders)
    }

    // Guard: don't create a new checkout session if the user already has an
    // active or trialing subscription. Return a 409 pointing them to the portal.
    const existingSub = await db.prepare(`
      SELECT id FROM subscriptions
      WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due')
      LIMIT 1
    `).bind(user.sub).first()
    if (existingSub) {
      return jsonResponse({
        error: 'You already have an active subscription. Use the customer portal to manage it.',
        code: 'subscription_exists',
      }, 409, corsHeaders)
    }

    const frontendUrl = String(env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const returnPath = normalizeReturnPath(body?.returnPath)
    if (provider === 'stripe') {
      const priceId = await getSetting(env, `stripe_price_${planType}`, { ttlSeconds: 300 })
      if (!priceId) {
        return jsonResponse({
          error: 'Stripe prices not yet configured. Ask an admin to set stripe_price_* in admin_settings.',
          code: 'prices_not_configured',
        }, 503, corsHeaders)
      }

      const sessionPayload: any = {
        mode: 'subscription',
        ui_mode: 'elements',
        // Curated list for the Payment Element (not dynamic payment methods): limits
        // the "Pay by card" path to card + PayPal + SEPA debit. Omitting
        // payment_method_types would surface every method enabled in the Stripe Dashboard
        // (e.g. Bancontact, Revolut Pay). Prices are EUR; sepa_debit requires EUR.
        payment_method_types: ['card', 'paypal', 'sepa_debit'],
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: user.email,
        metadata: {
          userId: user.sub,
          provider: 'stripe',
          planType,
          promoCodeId: promoMeta?.promoCodeId ?? '',
          promoCode: promoMeta?.promoCode ?? '',
          promoRewardType: promoMeta?.rewardType ?? '',
        },
        return_url: `${frontendUrl}${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
      }
      if (promoMeta?.stripeCouponId) {
        sessionPayload.discounts = [{ coupon: promoMeta.stripeCouponId }]
      }
      const session = await stripePost('/checkout/sessions', sessionPayload, env)

      if (session.error || !session.client_secret) {
        const stripeMessage = typeof session.error?.message === 'string'
          ? session.error.message
          : null
        console.error('Stripe checkout session error:', session.error)
        const stripeStatus = session.error?.code === 'stripe_timeout' ? 504 : 502
        return jsonResponse({
          error: stripeMessage ?? 'Failed to create checkout session',
          code: session.error?.code ?? 'stripe_checkout_failed',
        }, stripeStatus, corsHeaders)
      }

      return jsonResponse({ clientSecret: session.client_secret, provider }, 200, corsHeaders)
    }

    if (provider === 'legacy') {
      return startLegacyCheckout(env, user, body, corsHeaders)
    }

    const promoCodeInput = typeof body?.promoCode === 'string' ? body.promoCode.trim() : ''
    let promoCodeId: string | null = null
    let gocardlessDiscountPercentSnapshot: number | null = null
    let gocardlessPlanCodeSnapshot: string | null = null
    if (promoCodeInput) {
      const promoValidation = await resolvePromoCodeForCheckout(env, promoCodeInput, planType, 'gocardless')
      if (!promoValidation.ok) {
        return jsonResponse({
          error: promoValidation.error ?? 'Promo code is not valid',
          code: promoValidation.reason ?? 'invalid_promo',
        }, promoValidation.status ?? 400, corsHeaders)
      }
      promoCodeId = promoValidation.checkoutMeta?.promoCodeId ?? null
      const discountSnapshot = Number(promoValidation.checkoutMeta?.gocardlessDiscountPercent)
      gocardlessDiscountPercentSnapshot = Number.isFinite(discountSnapshot) ? discountSnapshot : null
      gocardlessPlanCodeSnapshot = promoValidation.checkoutMeta?.gocardlessPlanCode || null
    }

    const pricing = await getEffectivePricingSettings(env, 'gocardless')
    const planAmount = pricing[planType]
    if (planAmount == null || !Number.isFinite(planAmount)) {
      return jsonResponse({
        error: 'GoCardless pricing is not configured for the selected plan.',
        code: 'prices_not_configured',
      }, 503, corsHeaders)
    }

    const currency = normalizeGoCardlessCurrency(
      await getSetting(env, 'gocardless_currency', { defaultValue: 'EUR' }),
    )

    const checkoutToken = crypto.randomUUID()
    const checkoutSessionId = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO payment_checkout_sessions
        (id, user_id, provider, plan_type, checkout_token, session_token, status, promo_code_id, gocardless_discount_percent_snapshot, gocardless_plan_code_snapshot, gocardless_currency_snapshot, updated_at)
      VALUES (?, ?, 'gocardless', ?, ?, ?, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(checkoutSessionId, user.sub, planType, checkoutToken, null, promoCodeId, gocardlessDiscountPercentSnapshot, gocardlessPlanCodeSnapshot, currency).run()

    const billingRequestPayload = buildGoCardlessMandateBillingRequestPayload({
      currency,
      // GoCardless allows at most 3 metadata keys on billing_requests; currency is on mandate_request.
      metadata: {
        userId: user.sub,
        planType,
        checkoutToken,
      },
      creditorId: env.GOCARDLESS_CREDITOR_ID,
    })
    const billingRequestResponse = await gocardlessPost('/billing_requests', billingRequestPayload, env)
    const billingRequest = billingRequestResponse?.data?.billing_requests
    if (!billingRequestResponse.ok || !billingRequest?.id) {
      console.error('GoCardless billing request error:', billingRequestResponse?.data)
      return jsonResponse({
        error: formatGoCardlessApiError(billingRequestResponse, 'Failed to create GoCardless billing request'),
        code: 'gocardless_billing_request_failed',
      }, 502, corsHeaders)
    }

    const userRow = await db.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(user.sub).first()
    const customerEmail = String(userRow?.email ?? user.email ?? '').trim().toLowerCase()
    const defaultCountry = String(
      await getSetting(env, 'gocardless_default_country_code', { defaultValue: 'SK' }),
    ).trim().toUpperCase()
    if (customerEmail) {
      await prefillGoCardlessBillingRequestCustomer(
        billingRequest.id,
        customerEmail,
        env,
        defaultCountry,
      )
    }

    const flowResponse = await gocardlessPost(
      '/billing_request_flows',
      buildGoCardlessBillingRequestFlowCreatePayload({
        billingRequestId: billingRequest.id,
        redirectUri: `${frontendUrl}/account?gocardless_checkout_token=${checkoutToken}`,
        exitUri: `${frontendUrl}/account?gocardless_checkout_token=${checkoutToken}&gocardless_retry=1`,
        customerEmail,
      }),
      env,
    )

    const billingRequestFlow = flowResponse?.data?.billing_request_flows
    if (!flowResponse.ok || !billingRequestFlow?.id || !billingRequestFlow?.authorisation_url) {
      console.error('GoCardless billing request flow error:', flowResponse?.data)
      return jsonResponse({
        error: formatGoCardlessApiError(flowResponse, 'Failed to create GoCardless checkout flow'),
        code: 'gocardless_billing_request_flow_failed',
      }, 502, corsHeaders)
    }

    await db.prepare(`
      UPDATE payment_checkout_sessions
      SET provider_checkout_id = ?, session_token = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(billingRequestFlow.id, billingRequest.id, checkoutSessionId).run()

    return jsonResponse({
      checkoutUrl: billingRequestFlow.authorisation_url,
      provider,
    }, 200, corsHeaders)
  } catch (err: unknown) {
    console.error('handleCheckout error:', err)
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : ''
    if (code === 'stripe_timeout') {
      return jsonResponse({ error: 'Payment provider timed out. Please try again.', code }, 504, corsHeaders)
    }
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * POST /api/payments/webhook — NO auth (Stripe calls this directly)
 * Verifies Stripe signature and handles subscription lifecycle events.
 */
export async function handleWebhook(request: any, env: any, corsHeaders: any) {
  // Read raw body as text — must be done before any parsing to keep the
  // exact bytes Stripe used when generating the signature.
  const rawBody = await request.text()
  const sigHeader = request.headers.get('Stripe-Signature') ?? ''

  const valid = await verifyStripeWebhook(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET)
  if (!valid) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 400, corsHeaders)
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders)
  }

  try {
    const db = getDb(env)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.metadata?.userId
        if (!userId || !session.subscription) break

        // Fetch the full subscription object to get current_period_end and plan
        const stripeSub = await stripeGet(`/subscriptions/${session.subscription}`, env)
        if (stripeSub.id) {
          await upsertStripeSubscription(db, userId, stripeSub, env)
          const promoCodeId = typeof session?.metadata?.promoCodeId === 'string' ? session.metadata.promoCodeId.trim() : ''
          if (promoCodeId) {
            await applyPromoRedemption(env, {
              promoCodeId,
              userId,
              provider: 'stripe',
              planType: String(session?.metadata?.planType || 'monthly'),
              providerSubscriptionId: stripeSub.id ?? null,
              grantedUntil: stripeSubscriptionPeriodEndIso(stripeSub),
            })
          }
          try {
            await syncNewsletterForStripeSubscription(db, userId, stripeSub.status, env)
          } catch (brevoErr) {
            console.error(
              '[stripe webhook] syncNewsletterForStripeSubscription failed',
              { fn: 'syncNewsletterForStripeSubscription', userId, stripeStatus: stripeSub.status, err: brevoErr },
            )
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object
        // Find our user_id via stripe_subscription_id
        const existing = await db.prepare(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1'
        ).bind(stripeSub.id).first()
        if (existing) {
          await upsertStripeSubscription(db, existing.user_id, stripeSub, env)
          try {
            await syncNewsletterForStripeSubscription(db, existing.user_id, stripeSub.status, env)
          } catch (brevoErr) {
            console.error(
              '[stripe webhook] syncNewsletterForStripeSubscription failed',
              { fn: 'syncNewsletterForStripeSubscription', userId: existing.user_id, stripeStatus: stripeSub.status, err: brevoErr },
            )
          }
        }
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object
        if (!invoice.subscription) break
        const stripeSub = await stripeGet(`/subscriptions/${invoice.subscription}`, env)
        if (!stripeSub.id) break
        const existing = await db.prepare(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1'
        ).bind(stripeSub.id).first()
        if (existing) {
          await upsertStripeSubscription(db, existing.user_id, stripeSub, env)
          try {
            await syncNewsletterForStripeSubscription(db, existing.user_id, stripeSub.status, env)
          } catch (brevoErr) {
            console.error(
              '[stripe webhook] syncNewsletterForStripeSubscription failed',
              { fn: 'syncNewsletterForStripeSubscription', userId: existing.user_id, stripeStatus: stripeSub.status, err: brevoErr },
            )
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object
        const row = await db.prepare(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1'
        ).bind(stripeSub.id).first()
        await db.prepare(`
          UPDATE subscriptions
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE stripe_subscription_id = ?
        `).bind(stripeSub.id).run()
        if (row?.user_id) {
          try {
            await removeSubscriberFromNewsletter(db, row.user_id, env)
          } catch (brevoErr) {
            console.error(
              '[stripe webhook] removeSubscriberFromNewsletter failed',
              { fn: 'removeSubscriberFromNewsletter', userId: row.user_id, err: brevoErr },
            )
          }
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        if (invoice.subscription) {
          const existing = await db.prepare(
            'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1'
          ).bind(invoice.subscription).first()
          await db.prepare(`
            UPDATE subscriptions
            SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
            WHERE stripe_subscription_id = ?
          `).bind(invoice.subscription).run()
          if (existing?.user_id) {
            try {
              await removeSubscriberFromNewsletter(db, existing.user_id, env)
            } catch (brevoErr) {
              console.error(
                '[stripe webhook] removeSubscriberFromNewsletter failed',
                { fn: 'removeSubscriberFromNewsletter', userId: existing.user_id, err: brevoErr },
              )
            }
          }
        }
        break
      }

      default:
        // Unhandled event type — acknowledge receipt so Stripe doesn't retry
        break
    }

    return jsonResponse({ ok: true }, 200, corsHeaders)
  } catch (err) {
    console.error('handleWebhook error:', err)
    // Return 500 so Stripe retries the event on transient failures
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * POST /api/payments/webhook/gocardless — NO auth (GoCardless calls this directly)
 */
export async function handleGoCardlessWebhook(request: any, env: any, corsHeaders: any) {
  const rawBody = await request.text()
  const signature = request.headers.get('Webhook-Signature') ?? ''
  const valid = await verifyGoCardlessWebhook(rawBody, signature, String(env.GOCARDLESS_WEBHOOK_SECRET ?? ''))
  if (!valid) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 400, corsHeaders)
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders)
  }

  const events = Array.isArray(payload?.events) ? payload.events : []
  if (events.length === 0) return jsonResponse({ ok: true }, 200, corsHeaders)

  try {
    const db = getDb(env)
    for (const event of events) {
      const resourceType = String(event?.resource_type ?? '')
      const subscriptionId = String(event?.links?.subscription ?? '').trim()
      if (resourceType !== 'subscriptions' || !subscriptionId) continue

      const existing = await db.prepare(`
        SELECT user_id, plan_type
        FROM subscriptions
        WHERE provider = 'gocardless' AND provider_subscription_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(subscriptionId).first()
      if (!existing?.user_id) continue

      const subResponse = await gocardlessGet(`/subscriptions/${subscriptionId}`, env)
      if (!subResponse?.ok || !subResponse?.data?.subscriptions) {
        console.error('GoCardless webhook: failed to fetch subscription', { subscriptionId, response: subResponse })
        return jsonResponse({ error: 'Failed to fetch subscription from GoCardless' }, 500, corsHeaders)
      }

      const gocardlessSub = subResponse.data.subscriptions
      const status = normalizeGoCardlessStatus(gocardlessSub?.status)
      const currentPeriodEnd = gocardlessSub?.upcoming_payments?.[0]?.charge_date
        ? new Date(`${gocardlessSub.upcoming_payments[0].charge_date}T00:00:00.000Z`).toISOString()
        : null
      const planType = normalizePlanType(String(existing.plan_type || gocardlessSub?.metadata?.planType || 'monthly'))
      const customerId = String(gocardlessSub?.links?.customer ?? gocardlessSub?.links?.mandate ?? '')

      await upsertSubscriptionRow(db, {
        userId: existing.user_id,
        planType,
        status,
        provider: 'gocardless',
        providerSubscriptionId: subscriptionId,
        providerCustomerId: customerId || null,
        currentPeriodEnd,
      })
      if (status === 'active' || status === 'trialing') {
        try {
          await syncNewsletterForStripeSubscription(db, existing.user_id, 'active', env)
        } catch (brevoErr) {
          console.error(
            '[gocardless webhook] syncNewsletterForStripeSubscription failed',
            { userId: existing.user_id, providerSubscriptionId: subscriptionId, status, err: brevoErr },
          )
        }
      } else if (status === 'cancelled' || status === 'past_due') {
        try {
          await removeSubscriberFromNewsletter(db, existing.user_id, env)
        } catch (brevoErr) {
          console.error(
            '[gocardless webhook] removeSubscriberFromNewsletter failed',
            { userId: existing.user_id, providerSubscriptionId: subscriptionId, status, err: brevoErr },
          )
        }
      }
    }
    return jsonResponse({ ok: true }, 200, corsHeaders)
  } catch (err) {
    console.error('handleGoCardlessWebhook error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * POST /api/payments/gocardless/complete — protected
 * Completes a billing request flow after bank authorization and creates the recurring subscription.
 */
export async function handleGoCardlessComplete(request: any, env: any, corsHeaders: any) {
  let user: any
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const billingRequestFlowId = String(body?.billingRequestFlowId ?? '').trim()
  const checkoutToken = String(body?.checkoutToken ?? '').trim()
  if (!checkoutToken) {
    return jsonResponse({ error: 'checkoutToken is required' }, 400, corsHeaders)
  }

  try {
    const db = getDb(env)
    const sessionColumns = `
      id, user_id, plan_type, session_token, provider_checkout_id, status, promo_code_id,
      gocardless_discount_percent_snapshot, gocardless_plan_code_snapshot, gocardless_currency_snapshot,
      provider_subscription_id
    `
    let checkoutSession: any
    if (billingRequestFlowId) {
      checkoutSession = await db.prepare(`
        SELECT ${sessionColumns}
        FROM payment_checkout_sessions
        WHERE provider = 'gocardless'
          AND user_id = ?
          AND checkout_token = ?
          AND provider_checkout_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(user.sub, checkoutToken, billingRequestFlowId).first()
    } else {
      checkoutSession = await db.prepare(`
        SELECT ${sessionColumns}
        FROM payment_checkout_sessions
        WHERE provider = 'gocardless'
          AND user_id = ?
          AND checkout_token = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(user.sub, checkoutToken).first()
    }

    if (!checkoutSession) {
      return jsonResponse({ error: 'Checkout session not found' }, 404, corsHeaders)
    }

    if (checkoutSession.status === 'completed') {
      return jsonResponse({
        ok: true,
        alreadyCompleted: true,
        provider: 'gocardless',
        subscriptionId: checkoutSession.provider_subscription_id ?? null,
      }, 200, corsHeaders)
    }

    const billingRequestId = String(checkoutSession.session_token ?? '').trim()
    if (!billingRequestId.startsWith('BRQ')) {
      return jsonResponse({
        error: 'Checkout session is missing a billing request id. Start checkout again.',
        code: 'billing_request_missing',
      }, 409, corsHeaders)
    }

    const mandateResolution = await resolveFulfilledBillingRequestMandate(
      billingRequestId,
      env,
      `gocardless-fulfil:${checkoutToken}`,
    )
    if (!mandateResolution.ok) {
      console.error('GoCardless billing request mandate resolution failed:', {
        billingRequestId,
        reason: mandateResolution.reason,
        status: mandateResolution.billingRequest?.status,
        data: mandateResolution.billingRequest,
      })
      return jsonResponse({ error: 'Failed to complete GoCardless authorization' }, 502, corsHeaders)
    }
    const billingRequest = mandateResolution.billingRequest
    const mandateId = mandateResolution.mandateId

    const pricing = await getEffectivePricingSettings(env, 'gocardless')
    const planType = normalizePlanType(String(checkoutSession.plan_type || 'monthly'))
    let amountEur = pricing[planType]
    if (amountEur == null || !Number.isFinite(amountEur)) {
      return jsonResponse({ error: 'Pricing is not configured for selected plan' }, 503, corsHeaders)
    }
    const snapshotPercent = Number(checkoutSession.gocardless_discount_percent_snapshot)
    if (Number.isFinite(snapshotPercent) && snapshotPercent > 0 && snapshotPercent <= 100) {
      amountEur = Number((amountEur * (1 - snapshotPercent / 100)).toFixed(2))
    } else if (checkoutSession.promo_code_id) {
      // Backward-compatible fallback for sessions created before snapshot support.
      const promoRow: any = await db.prepare(`
        SELECT reward_type, gocardless_discount_percent
        FROM promo_codes
        WHERE id = ?
        LIMIT 1
      `).bind(checkoutSession.promo_code_id).first()
      if (promoRow?.reward_type === 'discount_percent') {
        const percent = Number(promoRow.gocardless_discount_percent)
        if (Number.isFinite(percent) && percent > 0 && percent <= 100) {
          amountEur = Number((amountEur * (1 - percent / 100)).toFixed(2))
        }
      }
    }

    const interval = getGoCardlessInterval(planType)
    const snapshotCurrency = String(checkoutSession.gocardless_currency_snapshot ?? '').trim()
    const currency = snapshotCurrency
      ? normalizeGoCardlessCurrency(snapshotCurrency)
      : normalizeGoCardlessCurrency(await getSetting(env, 'gocardless_currency', { defaultValue: 'EUR' }))
    const snapshotPlanCode = String(checkoutSession.gocardless_plan_code_snapshot ?? '').trim()
    let planName: string
    if (snapshotPlanCode) {
      planName = snapshotPlanCode
    } else {
      const planNameRaw = await getSetting(env, `gocardless_plan_${planType}`, { defaultValue: `VMP ${planType}` })
      planName = String(planNameRaw || `VMP ${planType}`)
    }
    const subscriptionResponse = await gocardlessPost('/subscriptions', {
      subscriptions: {
        amount: moneyToMinorUnits(amountEur),
        currency,
        name: planName,
        interval: interval.interval,
        interval_unit: interval.intervalUnit,
        day_of_month: 1,
        links: {
          mandate: mandateId,
        },
        metadata: {
          userId: user.sub,
          planType,
          checkoutToken,
        },
      },
    }, env, { 'Idempotency-Key': checkoutToken })
    const gocardlessSub = subscriptionResponse?.data?.subscriptions
    if (!subscriptionResponse.ok || !gocardlessSub?.id) {
      console.error('GoCardless create subscription error:', subscriptionResponse?.data)
      return jsonResponse({ error: 'Failed to create GoCardless subscription' }, 502, corsHeaders)
    }

    const status = normalizeGoCardlessStatus(String(gocardlessSub.status ?? 'pending_customer_approval'))
    const currentPeriodEnd = gocardlessSub?.upcoming_payments?.[0]?.charge_date
      ? new Date(`${gocardlessSub.upcoming_payments[0].charge_date}T00:00:00.000Z`).toISOString()
      : null
    const providerCustomerId = String(gocardlessSub?.links?.customer ?? billingRequest?.links?.customer ?? mandateId ?? '')
    await upsertSubscriptionRow(db, {
      userId: user.sub,
      planType,
      status,
      provider: 'gocardless',
      providerSubscriptionId: gocardlessSub.id,
      providerCustomerId: providerCustomerId || null,
      currentPeriodEnd,
    })

    await db.prepare(`
      UPDATE payment_checkout_sessions
      SET status = 'completed',
          provider_subscription_id = ?,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(gocardlessSub.id, checkoutSession.id).run()
    if (status === 'active' || status === 'trialing') {
      try {
        await syncNewsletterForStripeSubscription(db, user.sub, 'active', env)
      } catch (brevoErr) {
        console.error(
          '[gocardless complete] syncNewsletterForStripeSubscription failed',
          { userId: user.sub, subscriptionId: gocardlessSub.id, status, err: brevoErr },
        )
      }
    }
    if (checkoutSession.promo_code_id) {
      await applyPromoRedemption(env, {
        promoCodeId: String(checkoutSession.promo_code_id),
        userId: user.sub,
        provider: 'gocardless',
        planType,
        providerSubscriptionId: gocardlessSub.id,
        grantedUntil: currentPeriodEnd,
      })
    }

    return jsonResponse({
      ok: true,
      provider: 'gocardless',
      subscriptionStatus: status,
      subscriptionId: gocardlessSub.id,
    }, 200, corsHeaders)
  } catch (err) {
    console.error('handleGoCardlessComplete error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * POST /api/payments/gocardless/retry — protected
 * Re-opens GoCardless hosted checkout for a pending session (or latest pending for the user).
 * Body: { checkoutToken?: string, planType?: string }
 */
export async function handleGoCardlessRetry(request: any, env: any, corsHeaders: any) {
  let user: any
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const body = await request.json().catch(() => ({}))
  const checkoutTokenInput = String(body?.checkoutToken ?? '').trim()
  const planTypeInput = normalizePlanType(String(body?.planType ?? 'monthly'))

  try {
    const db = getDb(env)
    let checkoutSession: any = null
    if (checkoutTokenInput) {
      checkoutSession = await db.prepare(`
        SELECT id, user_id, plan_type, checkout_token, session_token, status
        FROM payment_checkout_sessions
        WHERE provider = 'gocardless'
          AND user_id = ?
          AND checkout_token = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(user.sub, checkoutTokenInput).first()
    } else {
      checkoutSession = await db.prepare(`
        SELECT id, user_id, plan_type, checkout_token, session_token, status
        FROM payment_checkout_sessions
        WHERE provider = 'gocardless'
          AND user_id = ?
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(user.sub).first()
    }

    if (!checkoutSession || checkoutSession.status === 'completed') {
      return jsonResponse({
        error: 'No pending GoCardless checkout to resume. Start checkout again.',
        code: 'checkout_not_found',
      }, 404, corsHeaders)
    }

    const planType = normalizePlanType(String(checkoutSession.plan_type || planTypeInput))
    const checkoutToken = String(checkoutSession.checkout_token)
    const frontendUrl = (env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')

    const userRow = await db.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(user.sub).first()
    const customerEmail = String(userRow?.email ?? user.email ?? '').trim().toLowerCase()
    if (!customerEmail) {
      return jsonResponse({ error: 'Account email is missing. Contact support.' }, 400, corsHeaders)
    }

    const currency = normalizeGoCardlessCurrency(
      await getSetting(env, 'gocardless_currency', { defaultValue: 'EUR' }),
    )
    const defaultCountry = String(
      await getSetting(env, 'gocardless_default_country_code', { defaultValue: 'SK' }),
    ).trim().toUpperCase()

    const billingRequestPayload = buildGoCardlessMandateBillingRequestPayload({
      currency,
      metadata: {
        userId: user.sub,
        planType,
        checkoutToken,
      },
      creditorId: env.GOCARDLESS_CREDITOR_ID,
    })
    const billingRequestResponse = await gocardlessPost('/billing_requests', billingRequestPayload, env)
    const billingRequest = billingRequestResponse?.data?.billing_requests
    if (!billingRequestResponse.ok || !billingRequest?.id) {
      return jsonResponse({
        error: formatGoCardlessApiError(billingRequestResponse, 'Failed to create GoCardless billing request'),
        code: 'gocardless_billing_request_failed',
      }, 502, corsHeaders)
    }

    await prefillGoCardlessBillingRequestCustomer(
      billingRequest.id,
      customerEmail,
      env,
      defaultCountry,
    )

    const flowResponse = await gocardlessPost(
      '/billing_request_flows',
      buildGoCardlessBillingRequestFlowCreatePayload({
        billingRequestId: billingRequest.id,
        redirectUri: `${frontendUrl}/account?gocardless_checkout_token=${checkoutToken}`,
        exitUri: `${frontendUrl}/account?gocardless_checkout_token=${checkoutToken}&gocardless_retry=1`,
        customerEmail,
      }),
      env,
    )
    const billingRequestFlow = flowResponse?.data?.billing_request_flows
    if (!flowResponse.ok || !billingRequestFlow?.id || !billingRequestFlow?.authorisation_url) {
      return jsonResponse({
        error: formatGoCardlessApiError(flowResponse, 'Failed to create GoCardless checkout flow'),
        code: 'gocardless_billing_request_flow_failed',
      }, 502, corsHeaders)
    }

    await db.prepare(`
      UPDATE payment_checkout_sessions
      SET provider_checkout_id = ?, session_token = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(billingRequestFlow.id, billingRequest.id, checkoutSession.id).run()

    return jsonResponse({ checkoutUrl: billingRequestFlow.authorisation_url }, 200, corsHeaders)
  } catch (err) {
    console.error('handleGoCardlessRetry error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * GET /api/account/subscription — protected
 * Returns the most recent subscription row for the authenticated user.
 */
export async function handleGetSubscription(request: any, env: any, corsHeaders: any) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  try {
    const db = getDb(env)
    if (isAdministrativeRole(user.role)) {
      const now = new Date().toISOString()
      return jsonResponse({
        subscription: {
          id:                  `role:${user.role}`,
          planType:            'staff',
          status:              'active',
          provider:            'staff',
          providerCustomerId:  null,
          stripeCustomerId:    null,
          currentPeriodEnd:    null,
          createdAt:           now,
          updatedAt:           now,
        },
      }, 200, corsHeaders)
    }

    const sub = await db.prepare(`
      SELECT id, user_id, plan_type, status, provider, provider_customer_id, stripe_customer_id,
             current_period_end, created_at, updated_at
      FROM subscriptions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(user.sub).first()

    if (!sub) {
      return jsonResponse({ subscription: null }, 200, corsHeaders)
    }

    return jsonResponse({
      subscription: {
        id:                  sub.id,
        planType:            sub.plan_type,
        status:              sub.status,
        provider:            sub.provider ?? 'stripe',
        providerCustomerId:  sub.provider_customer_id ?? null,
        stripeCustomerId:    sub.stripe_customer_id,
        currentPeriodEnd:    sub.current_period_end,
        createdAt:           sub.created_at,
        updatedAt:           sub.updated_at,
      },
    }, 200, corsHeaders)
  } catch (err) {
    console.error('handleGetSubscription error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

/**
 * POST /api/payments/portal — protected
 * Creates a Stripe Customer Portal session so users can manage their subscription.
 * Returns { portalUrl }.
 */
export async function handlePortal(request: any, env: any, corsHeaders: any) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  try {
    const db = getDb(env)
    const sub = await db.prepare(`
      SELECT provider, stripe_customer_id FROM subscriptions
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(user.sub).first()

    if (!sub) {
      return jsonResponse({ error: 'No active subscription found' }, 404, corsHeaders)
    }
    if ((sub.provider ?? 'stripe') !== 'stripe') {
      const manageUrl = String(await getSetting(env, 'gocardless_manage_subscription_url', { defaultValue: '' }) ?? '').trim()
      if (manageUrl) return jsonResponse({ portalUrl: manageUrl }, 200, corsHeaders)
      return jsonResponse({
        error: 'Customer portal is not available for this payment provider.',
        code: 'portal_not_supported',
      }, 409, corsHeaders)
    }
    if (!sub?.stripe_customer_id) {
      return jsonResponse({ error: 'No active subscription found' }, 404, corsHeaders)
    }

    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000'
    const portalSession = await stripePost('/billing_portal/sessions', {
      customer:   sub.stripe_customer_id,
      return_url: `${frontendUrl}/account`,
    }, env)

    if (portalSession.error || !portalSession.url) {
      console.error('Stripe portal session error:', portalSession.error)
      return jsonResponse({ error: 'Failed to create portal session' }, 502, corsHeaders)
    }

    return jsonResponse({ portalUrl: portalSession.url }, 200, corsHeaders)
  } catch (err) {
    console.error('handlePortal error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}