/**
 * Provider-agnostic payments orchestration (Stripe + optional legacy).
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

type PlanType = 'monthly' | 'yearly' | 'club'
type PaymentProvider = 'stripe' | 'legacy'
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled'

async function getAllowedPlans(env: any): Promise<PlanType[]> {
  const raw = String(await getSetting(env, 'allowed_plans', { defaultValue: 'monthly,yearly,club' }) ?? 'monthly,yearly,club')
  const plans = raw
    .split(',')
    .map((v: string) => v.trim().toLowerCase())
    .filter((v: string): v is PlanType => v === 'monthly' || v === 'yearly' || v === 'club')
  const base: PlanType[] = plans.length > 0 ? plans : ['monthly', 'yearly', 'club']
  const enabled: PlanType[] = []
  for (const plan of base) {
    const flag = await getSetting(env, `${plan}_enabled`, { defaultValue: '1', ttlSeconds: 300 })
    if (String(flag ?? '1') !== '0') enabled.push(plan)
  }
  return enabled.length > 0 ? enabled : base
}

const CORE_PLAN_SLUGS = ['monthly', 'yearly', 'club'] as const

/** Plan slugs for admin UI — driven by `allowed_plans`, not broad admin_settings key scans. */
export function parseAllowedPlanSlugs(raw: unknown): string[] {
  const slugs = new Set<string>(CORE_PLAN_SLUGS)
  for (const part of String(raw ?? 'monthly,yearly,club').split(',')) {
    const slug = part.trim().toLowerCase()
    if (slug && /^[a-z][a-z0-9_]*$/.test(slug)) slugs.add(slug)
  }
  return Array.from(slugs)
}

async function discoverPlanSlugs(env: any): Promise<string[]> {
  const raw = await getSetting(env, 'allowed_plans', { defaultValue: 'monthly,yearly,club' })
  return parseAllowedPlanSlugs(raw)
}

async function buildAdminPlanList(env: any) {
  const slugs = await discoverPlanSlugs(env)
  const plans = []
  for (const id of slugs) {
    const [
      stripePriceId,
      amountRaw,
      label,
      interval,
      enabledRaw,
    ] = await Promise.all([
      getSetting(env, `stripe_price_${id}`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_price_eur`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_label`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_interval`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_enabled`, { defaultValue: '1', ttlSeconds: 300 }),
    ])
    const defaultLabel = id === 'monthly' ? 'Monthly' : id === 'yearly' ? 'Yearly' : id === 'club' ? 'Club' : id
    const defaultInterval = id === 'monthly' ? 'month' : 'year'
    const amountEur = parseConfiguredPrice(amountRaw)
    plans.push({
      id,
      label: String(label ?? defaultLabel),
      stripePriceId: String(stripePriceId ?? ''),
      amountEur,
      interval: String(interval ?? defaultInterval),
      enabled: String(enabledRaw ?? '1') !== '0',
    })
  }
  return plans
}

async function getPaymentProviderOrder(env: any): Promise<PaymentProvider[]> {
  const stored = await getSetting(env, 'payment_provider_order', { defaultValue: 'stripe,legacy' })
  const raw = String(stored ?? 'stripe,legacy').trim()
  const providers = (raw ? raw : 'stripe,legacy')
    .split(',')
    .map((v: string) => v.trim().toLowerCase())
    .filter((v: string): v is PaymentProvider => v === 'stripe' || v === 'legacy')
  return providers.length > 0 ? providers : ['stripe']
}

/** Gateways enabled for new checkouts (Stripe default; legacy optional). */
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
    const allowedPlans = await getAllowedPlans(env)
    const pricingNotConfigured = (
      (allowedPlans.includes('monthly') && stripePricing.monthly == null)
      || (allowedPlans.includes('yearly') && stripePricing.yearly == null)
      || (allowedPlans.includes('club') && stripePricing.club == null)
    )
    const payload = {
      monthly: allowedPlans.includes('monthly') ? stripePricing.monthly : null,
      yearly: allowedPlans.includes('yearly') ? stripePricing.yearly : null,
      club: allowedPlans.includes('club') ? stripePricing.club : null,
      allowedPlans,
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
      'stripe_price_monthly',
      'stripe_price_yearly',
      'stripe_price_club',
    ] as const
    const values = await Promise.all(keys.map((key) => getSetting(env, key)))
    const valueByKey = Object.fromEntries(keys.map((key, index) => [key, values[index]]))
    return jsonResponse({
      enabledProviders: parseCsvList(valueByKey.payments_enabled_providers ?? 'stripe', ['stripe', 'legacy']),
      providerOrder: parseCsvList(valueByKey.payment_provider_order ?? 'stripe,legacy', ['stripe', 'legacy']),
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
    const enabledProviders = parseCsvList(body.enabledProviders ?? 'stripe', ['stripe', 'legacy'])
    if (!enabledProviders.length) {
      return jsonResponse({ error: 'At least one payment provider must be enabled' }, 400, corsHeaders)
    }
    const providerOrder = parseCsvList(body.providerOrder ?? enabledProviders, ['stripe', 'legacy'])
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

function slugifyPlanLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'plan'
}

/**
 * GET /api/admin/payments/plans — list configurable subscription plans
 * PATCH — update or create a plan row
 */
export async function handleAdminPaymentPlans(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method === 'GET') {
    const plans = await buildAdminPlanList(env)
    const [
      legacyManageUrl,
      legacyProviderName,
      legacyShowManageButton,
      legacyConfigured,
    ] = await Promise.all([
      getSetting(env, 'legacy_manage_subscription_url', { ttlSeconds: 300 }),
      getSetting(env, 'legacy_provider_name', { ttlSeconds: 300 }),
      getSetting(env, 'legacy_show_manage_button', { ttlSeconds: 300 }),
      Promise.resolve(isLegacyProviderConfigured(env)),
    ])
    return jsonResponse({
      plans,
      legacy: {
        configured: legacyConfigured,
        manageSubscriptionUrl: String(legacyManageUrl ?? ''),
        providerName: String(legacyProviderName ?? ''),
        showManageButton: String(legacyShowManageButton ?? '0') === '1',
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
    if (body.legacy && typeof body.legacy === 'object') {
      const legacy = body.legacy
      const updates: [string, string][] = []
      if (typeof legacy.manageSubscriptionUrl === 'string') {
        updates.push(['legacy_manage_subscription_url', legacy.manageSubscriptionUrl.trim()])
      }
      if (typeof legacy.providerName === 'string') {
        updates.push(['legacy_provider_name', legacy.providerName.trim()])
      }
      if (typeof legacy.showManageButton === 'boolean') {
        updates.push(['legacy_show_manage_button', legacy.showManageButton ? '1' : '0'])
      }
      if (updates.length) await setSettings(env, updates)
    }

    const plan = body.plan
    if (plan && typeof plan === 'object') {
      let id = typeof plan.id === 'string' ? plan.id.trim().toLowerCase() : ''
      if (!id && typeof plan.label === 'string') id = slugifyPlanLabel(plan.label)
      if (!id) return jsonResponse({ error: 'plan.id or plan.label is required' }, 400, corsHeaders)

      const updates: [string, string][] = []
      if (typeof plan.label === 'string' && plan.label.trim()) {
        updates.push([`${id}_label`, plan.label.trim()])
      }
      if (typeof plan.stripePriceId === 'string') {
        updates.push([`stripe_price_${id}`, plan.stripePriceId.trim()])
      }
      if (plan.amountEur != null && plan.amountEur !== '') {
        updates.push([`${id}_price_eur`, parseOptionalPositiveNumber(plan.amountEur)])
      }
      if (typeof plan.interval === 'string' && plan.interval.trim()) {
        updates.push([`${id}_interval`, plan.interval.trim()])
      }
      if (typeof plan.enabled === 'boolean') {
        updates.push([`${id}_enabled`, plan.enabled ? '1' : '0'])
      }

      if (!updates.length) {
        return jsonResponse({ error: 'No plan fields to update' }, 400, corsHeaders)
      }

      const allowedRaw = await getSetting(env, 'allowed_plans', { defaultValue: 'monthly,yearly,club' })
      const allowed = parseCsvList(allowedRaw ?? 'monthly,yearly,club', ['monthly', 'yearly', 'club'])
      if (!allowed.includes(id) && CORE_PLAN_SLUGS.includes(id as typeof CORE_PLAN_SLUGS[number])) {
        // core plan — ok
      } else if (!allowed.includes(id) && !CORE_PLAN_SLUGS.includes(id as typeof CORE_PLAN_SLUGS[number])) {
        const nextAllowed = [...allowed, id]
        updates.push(['allowed_plans', nextAllowed.join(',')])
      }

      await setSettings(env, updates)
    }

    const plans = await buildAdminPlanList(env)
    return jsonResponse({ ok: true, plans }, 200, corsHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid plan'
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

    return jsonResponse({
      error: 'Requested payment provider is not supported.',
      code: 'provider_not_supported',
    }, 400, corsHeaders)
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

    const provider = sub.provider ?? 'stripe'
    let legacyManageUrl: string | null = null
    let showLegacyManageButton = false
    if (provider === 'legacy') {
      const [urlRaw, showRaw] = await Promise.all([
        getSetting(env, 'legacy_manage_subscription_url', { ttlSeconds: 300 }),
        getSetting(env, 'legacy_show_manage_button', { ttlSeconds: 300 }),
      ])
      const url = String(urlRaw ?? '').trim()
      legacyManageUrl = url || null
      showLegacyManageButton = String(showRaw ?? '0') === '1' && Boolean(url)
    }

    return jsonResponse({
      subscription: {
        id:                  sub.id,
        planType:            sub.plan_type,
        status:              sub.status,
        provider,
        providerCustomerId:  sub.provider_customer_id ?? null,
        stripeCustomerId:    sub.stripe_customer_id,
        currentPeriodEnd:    sub.current_period_end,
        createdAt:           sub.created_at,
        updatedAt:           sub.updated_at,
        legacyManageUrl,
        showLegacyManageButton,
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
      const manageUrl = String(await getSetting(env, 'legacy_manage_subscription_url', { defaultValue: '' }) ?? '').trim()
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