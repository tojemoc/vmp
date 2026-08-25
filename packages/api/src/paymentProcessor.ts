/**
 * Provider-agnostic payments orchestration (Stripe + optional legacy).
 */

import { requireAuth, requireRole } from './auth.js';
import { removeSubscriberFromNewsletter, syncNewsletterForSubscription } from './brevo.js';
import { applyPromoRedemption, resolvePromoCodeForCheckout } from './promotions.js';
import { isAdministrativeRole } from './roles.js';
import { getSetting, setSettings } from './settingsStore.js';
import {
  normalizeStripeStatus,
  stripeCancelAtPeriodEnd,
  stripeGet,
  stripeSubscriptionPeriodEndIso,
} from './stripeClient.js';

export { normalizeStripeStatus } from './stripeClient.js';

import {
  createEnabledProviders,
  type DbPaymentProvider,
  type NormalizedPaymentEvent,
  type PaymentProviderId,
} from '@vmp/payments';
import { handlePaymentInvoicePaid } from './eInvoicing.js';
import {
  CUSTOMER_SAFE_BANK_PAYMENTS_UNAVAILABLE,
  looksLikePaymentConfigLeak,
} from './customerSafePaymentErrors.js';
import { isLegacyCheckoutConfigured, isLegacyWebhookConfigured } from './legacyProvider.js';
import { revokeOfflineLicensesForUser } from './offlineDownloads.js';
import { parseLocaleNumber } from './parseLocaleNumber.js';
import {
  captureMappedPostHogEvent,
  capturePostHogException,
  posthogEventFromStripeWebhook,
  type PostHogWaitUntilCtx,
} from './posthog.js';
import {
  buildPaymentsConfig,
  dbProviderToRegistryId,
  fromApiProviderId,
  getPaymentProviderOrder,
  getPaymentProviders,
  isComgateConfigured,
  isGoPayConfigured,
  providerIdToDbProvider,
  resolvePublicEnabledProviders,
  toApiProviderId,
  toSupportedApiProviderIds,
} from './paymentProviders.js';

export { parseLocaleNumber } from './parseLocaleNumber.js';

type PlanType = 'monthly' | 'yearly' | 'club';
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled';

async function getAllowedPlans(env: any): Promise<PlanType[]> {
  const raw = String(
    (await getSetting(env, 'allowed_plans', { defaultValue: 'monthly,yearly,club' })) ??
      'monthly,yearly,club',
  );
  const plans = raw
    .split(',')
    .map((v: string) => v.trim().toLowerCase())
    .filter((v: string): v is PlanType => v === 'monthly' || v === 'yearly' || v === 'club');
  const base: PlanType[] = plans.length > 0 ? plans : ['monthly', 'yearly', 'club'];
  const enabled: PlanType[] = [];
  for (const plan of base) {
    const flag = await getSetting(env, `${plan}_enabled`, { defaultValue: '1', ttlSeconds: 300 });
    if (String(flag ?? '1') !== '0') enabled.push(plan);
  }
  return enabled.length > 0 ? enabled : base;
}

const CORE_PLAN_SLUGS = ['monthly', 'yearly', 'club'] as const;

/** Plan slugs for admin UI — driven by `allowed_plans`, not broad admin_settings key scans. */
export function parseAllowedPlanSlugs(raw: unknown): string[] {
  const slugs = new Set<string>(CORE_PLAN_SLUGS);
  for (const part of String(raw ?? 'monthly,yearly,club').split(',')) {
    const slug = part.trim().toLowerCase();
    if (slug && /^[a-z][a-z0-9_]*$/.test(slug)) slugs.add(slug);
  }
  return Array.from(slugs);
}

async function discoverPlanSlugs(env: any): Promise<string[]> {
  const raw = await getSetting(env, 'allowed_plans', { defaultValue: 'monthly,yearly,club' });
  return parseAllowedPlanSlugs(raw);
}

async function buildAdminPlanList(env: any) {
  const slugs = await discoverPlanSlugs(env);
  const plans = [];
  for (const id of slugs) {
    const [stripePriceId, amountRaw, label, interval, enabledRaw] = await Promise.all([
      getSetting(env, `stripe_price_${id}`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_price_eur`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_label`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_interval`, { ttlSeconds: 300 }),
      getSetting(env, `${id}_enabled`, { defaultValue: '1', ttlSeconds: 300 }),
    ]);
    const defaultLabel =
      id === 'monthly' ? 'Monthly' : id === 'yearly' ? 'Yearly' : id === 'club' ? 'Club' : id;
    const defaultInterval = id === 'monthly' ? 'month' : 'year';
    const amountEur = parseConfiguredPrice(amountRaw);
    plans.push({
      id,
      label: String(label ?? defaultLabel),
      stripePriceId: String(stripePriceId ?? ''),
      amountEur,
      interval: String(interval ?? defaultInterval),
      enabled: String(enabledRaw ?? '1') !== '0',
    });
  }
  return plans;
}

// ─── D1 / admin_settings helpers ─────────────────────────────────────────────

function parseConfiguredPrice(value: unknown): number | null {
  return parseLocaleNumber(value);
}

async function getPricingSettings(
  env: any,
  provider?: 'stripe' | 'legacy' | 'gopay' | 'comgate',
) {
  if (provider === 'gopay' || provider === 'comgate') {
    const [monthly, yearly, club] = await Promise.all([
      getSetting(env, `${provider}_monthly_price`, { ttlSeconds: 300 }),
      getSetting(env, `${provider}_yearly_price`, { ttlSeconds: 300 }),
      getSetting(env, `${provider}_club_price`, { ttlSeconds: 300 }),
    ]);
    return {
      monthly: parseConfiguredPrice(monthly),
      yearly: parseConfiguredPrice(yearly),
      club: parseConfiguredPrice(club),
    };
  }
  const prefix = provider ? `${provider}_` : '';
  const [monthly, yearly, club] = await Promise.all([
    getSetting(env, `${prefix}monthly_price_eur`, { ttlSeconds: 300 }),
    getSetting(env, `${prefix}yearly_price_eur`, { ttlSeconds: 300 }),
    getSetting(env, `${prefix}club_price_eur`, { ttlSeconds: 300 }),
  ]);
  return {
    monthly: parseConfiguredPrice(monthly),
    yearly: parseConfiguredPrice(yearly),
    club: parseConfiguredPrice(club),
  };
}

async function getEffectivePricingSettings(
  env: any,
  provider: 'stripe' | 'legacy' | 'gopay' | 'comgate',
) {
  const [providerPricing, fallbackPricing] = await Promise.all([
    getPricingSettings(env, provider),
    provider === 'gopay' || provider === 'comgate'
      ? Promise.resolve({ monthly: null, yearly: null, club: null })
      : getPricingSettings(env),
  ]);
  return {
    monthly: providerPricing.monthly ?? fallbackPricing.monthly,
    yearly: providerPricing.yearly ?? fallbackPricing.yearly,
    club: providerPricing.club ?? fallbackPricing.club,
  };
}

function periodEndIsoForPlan(planType: PlanType): string {
  const end = new Date();
  if (planType === 'yearly' || planType === 'club') {
    end.setUTCMonth(end.getUTCMonth() + 12);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return end.toISOString();
}

// ─── D1 / admin_settings helpers ─────────────────────────────────────────────

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db;
  if (!db) throw new Error('D1 binding not found');
  return db;
}

/**
 * Resolve plan_type ('monthly'|'yearly'|'club') from a Stripe price ID
 * by comparing against the price IDs stored in admin_settings.
 */
async function resolvePlanType(db: any, stripePriceId: any, env: any): Promise<PlanType> {
  const keys = ['stripe_price_monthly', 'stripe_price_yearly', 'stripe_price_club'] as const;
  const planNames: PlanType[] = ['monthly', 'yearly', 'club'];
  for (let i = 0; i < keys.length; i++) {
    const stored = await getSetting(env, keys[i], { ttlSeconds: 300 });
    if (stored && stored === stripePriceId) return planNames[i] ?? 'monthly';
  }
  return 'monthly'; // fallback
}

function normalizePlanType(planType: string): PlanType {
  if (planType === 'yearly' || planType === 'club') return planType;
  return 'monthly';
}

/**
 * Resolve the paying user for a Comgate webhook when no subscription row exists yet
 * (first checkout). Relies on `payment_checkout_sessions` from migration
 * `0010_gocardless_payments.sql` — written at checkout creation with
 * `checkout_token = refId` and `provider_checkout_id = transId`.
 */
export async function resolveComgateCheckoutIdentity(
  db: {
    prepare: (sql: string) => {
      bind: (...args: unknown[]) => {
        first: () => Promise<{ id?: unknown; user_id?: unknown; plan_type?: unknown } | null>;
      };
    };
  },
  opts: { subscriptionId: string; purchaseId: string },
): Promise<{
  userId: string;
  planType: PlanType;
  pendingSessionId: string | null;
  fromPendingSession: boolean;
} | null> {
  const subscriptionId = String(opts.subscriptionId ?? '').trim();
  const purchaseId = String(opts.purchaseId ?? '').trim();
  if (!subscriptionId && !purchaseId) return null;

  const existing = await db
    .prepare(
      `SELECT user_id, plan_type FROM subscriptions
       WHERE provider = 'comgate' AND (provider_subscription_id = ? OR purchase_id = ?)
       LIMIT 1`,
    )
    .bind(subscriptionId, purchaseId || subscriptionId)
    .first();

  if (existing?.user_id) {
    return {
      userId: String(existing.user_id).trim(),
      planType: normalizePlanType(String(existing.plan_type ?? 'monthly')),
      pendingSessionId: null,
      fromPendingSession: false,
    };
  }

  const pending = await db
    .prepare(
      `SELECT id, user_id, plan_type FROM payment_checkout_sessions
       WHERE provider = 'comgate' AND status = 'pending'
         AND (checkout_token = ? OR provider_checkout_id = ?)
       LIMIT 1`,
    )
    .bind(purchaseId || subscriptionId, subscriptionId || purchaseId)
    .first();

  if (!pending?.user_id) return null;

  return {
    userId: String(pending.user_id).trim(),
    planType: normalizePlanType(String(pending.plan_type ?? 'monthly')),
    pendingSessionId: String(pending.id ?? '').trim() || null,
    fromPendingSession: true,
  };
}

async function upsertSubscriptionRow(
  db: any,
  params: {
    userId: string;
    planType: PlanType;
    status: SubscriptionStatus;
    provider: DbPaymentProvider;
    providerSubscriptionId: string | null;
    providerCustomerId: string | null;
    purchaseId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
  },
) {
  const cancelAtPeriodEnd = params.cancelAtPeriodEnd === true ? 1 : 0;
  await db
    .prepare(`
    INSERT INTO subscriptions
      (
        id,
        user_id,
        plan_type,
        status,
        provider,
        provider_subscription_id,
        provider_customer_id,
        purchase_id,
        stripe_subscription_id,
        stripe_customer_id,
        current_period_end,
        cancel_at_period_end,
        updated_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
      user_id                  = excluded.user_id,
      status                   = excluded.status,
      plan_type                = excluded.plan_type,
      provider_customer_id     = excluded.provider_customer_id,
      purchase_id              = COALESCE(excluded.purchase_id, subscriptions.purchase_id),
      stripe_subscription_id   = excluded.stripe_subscription_id,
      stripe_customer_id       = excluded.stripe_customer_id,
      current_period_end       = excluded.current_period_end,
      cancel_at_period_end     = excluded.cancel_at_period_end,
      updated_at               = CURRENT_TIMESTAMP
  `)
    .bind(
      crypto.randomUUID(),
      params.userId,
      params.planType,
      params.status,
      params.provider,
      params.providerSubscriptionId,
      params.providerCustomerId,
      params.purchaseId ?? null,
      params.stripeSubscriptionId ?? null,
      params.stripeCustomerId ?? null,
      params.currentPeriodEnd ?? null,
      cancelAtPeriodEnd,
    )
    .run();
}

async function upsertSubscriptionFromNormalizedEvent(
  db: any,
  env: any,
  event: NormalizedPaymentEvent,
): Promise<string | null> {
  const userId =
    typeof event.userId === 'string' && event.userId.trim()
      ? event.userId.trim()
      : await findUserIdForPaymentEvent(db, event);
  if (!userId) return null;

  let planType = event.planType;
  let status = event.status;
  let currentPeriodEnd = event.currentPeriodEnd ?? null;
  let providerSubscriptionId = event.subscriptionId?.trim() || null;
  let providerCustomerId = event.customerId?.trim() || null;
  let purchaseId = event.purchaseId?.trim() || null;
  let stripeSubscriptionId: string | null = null;
  let stripeCustomerId: string | null = null;
  let cancelAtPeriodEnd = event.cancelAtPeriodEnd === true;

  if (event.providerId === 'qerko') {
    const raw =
      event.raw && typeof event.raw === 'object' ? (event.raw as Record<string, unknown>) : {};
    const subscription =
      raw.subscription && typeof raw.subscription === 'object'
        ? (raw.subscription as Record<string, unknown>)
        : null;
    const cardOnFile = String(
      subscription?.cardOnFile ?? raw.cardOnFile ?? event.subscriptionId ?? event.purchaseId ?? '',
    ).trim();

    // Stable CardOnFile identity for ON CONFLICT(provider, provider_subscription_id).
    providerSubscriptionId = cardOnFile || event.subscriptionId?.trim() || null;
    purchaseId = event.purchaseId?.trim() || cardOnFile || purchaseId;
    if (!providerCustomerId && purchaseId) {
      providerCustomerId = purchaseId;
    }
  }

  if (event.providerId === 'stripe') {
    stripeSubscriptionId = providerSubscriptionId;
    stripeCustomerId = providerCustomerId;

    const rawSub =
      event.type === 'subscription.created' || event.type === 'subscription.updated'
        ? getNormalizedRawObject(event)
        : null;

    const needsStripeFetch =
      Boolean(providerSubscriptionId) &&
      (event.type === 'checkout.completed' ||
        event.type === 'invoice.paid' ||
        !planType ||
        (!status && rawSub?.id));

    if (needsStripeFetch && providerSubscriptionId) {
      const stripeSub = await stripeGet(`/subscriptions/${providerSubscriptionId}`, env);
      if (stripeSub?.id) {
        const priceId = stripeSub.items?.data?.[0]?.price?.id ?? null;
        if (!planType && priceId) {
          planType = (await resolvePlanType(db, priceId, env)) as PlanType;
        }
        status = status || String(stripeSub.status ?? '');
        currentPeriodEnd = currentPeriodEnd || stripeSubscriptionPeriodEndIso(stripeSub);
        providerSubscriptionId = String(stripeSub.id);
        providerCustomerId =
          typeof stripeSub.customer === 'string' ? stripeSub.customer : providerCustomerId;
        stripeSubscriptionId = providerSubscriptionId;
        stripeCustomerId = providerCustomerId;
        cancelAtPeriodEnd = stripeCancelAtPeriodEnd(stripeSub);
      }
    } else if (rawSub?.id) {
      if (!planType) {
        const priceId = (rawSub.items as { data?: Array<{ price?: { id?: string } }> })?.data?.[0]
          ?.price?.id;
        if (priceId) planType = (await resolvePlanType(db, priceId, env)) as PlanType;
      }
      if (!status && rawSub.status) status = String(rawSub.status);
      if (!currentPeriodEnd) {
        currentPeriodEnd = stripeSubscriptionPeriodEndIso(
          rawSub as Parameters<typeof stripeSubscriptionPeriodEndIso>[0],
        );
      }
      providerSubscriptionId = providerSubscriptionId || String(rawSub.id);
      if (!providerCustomerId && typeof rawSub.customer === 'string') {
        providerCustomerId = rawSub.customer;
      }
      cancelAtPeriodEnd = event.cancelAtPeriodEnd === true || stripeCancelAtPeriodEnd(rawSub);
    }
  }

  if (!providerSubscriptionId && !purchaseId) return userId;

  const dbStatus =
    event.providerId === 'stripe'
      ? normalizeStripeStatus(status ?? 'active')
      : normalizeGenericSubscriptionStatus(status ?? 'active');

  await upsertSubscriptionRow(db, {
    userId,
    planType: normalizePlanType(planType ?? 'monthly'),
    status: dbStatus,
    provider: providerIdToDbProvider(event.providerId),
    providerSubscriptionId,
    providerCustomerId,
    purchaseId,
    stripeSubscriptionId,
    stripeCustomerId,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  });
  return userId;
}

function stripeWebhookTypeForPostHog(event: NormalizedPaymentEvent): string | null {
  switch (event.type) {
    case 'checkout.completed':
      return 'checkout.session.completed';
    case 'subscription.deleted':
      return 'customer.subscription.deleted';
    case 'invoice.paid':
      return 'invoice.paid';
    case 'subscription.past_due':
      return 'invoice.payment_failed';
    default:
      return null;
  }
}

function captureStripeWebhookPostHog(
  env: any,
  event: NormalizedPaymentEvent,
  userId: string,
  ctx?: PostHogWaitUntilCtx,
) {
  if (event.providerId !== 'stripe') return;
  const stripeType = stripeWebhookTypeForPostHog(event);
  if (!stripeType) return;
  captureMappedPostHogEvent(
    env,
    posthogEventFromStripeWebhook(stripeType, getNormalizedRawObject(event), userId),
    ctx,
  );
}

function normalizeGenericSubscriptionStatus(raw: string): SubscriptionStatus {
  const value = raw.trim().toLowerCase();
  if (value === 'trialing') return 'trialing';
  if (value === 'past_due' || value === 'past-due') return 'past_due';
  if (value === 'cancelled' || value === 'canceled' || value === 'deleted') return 'cancelled';
  return 'active';
}

function getNormalizedRawObject(event: NormalizedPaymentEvent): Record<string, unknown> {
  if (!event.raw || typeof event.raw !== 'object') return {};
  const raw = event.raw as { data?: { object?: Record<string, unknown> } };
  return raw.data?.object ?? {};
}

async function findUserIdForPaymentEvent(
  db: any,
  event: Pick<
    NormalizedPaymentEvent,
    'providerId' | 'userId' | 'subscriptionId' | 'customerId' | 'purchaseId' | 'providerOrderId'
  >,
): Promise<string | null> {
  if (typeof event.userId === 'string' && event.userId.trim()) return event.userId.trim();

  const provider = providerIdToDbProvider(event.providerId);
  const refs: Array<{ column: string; value: string }> = [];
  const pushRef = (column: string, value: unknown) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return;
    if (!refs.some((ref) => ref.column === column && ref.value === normalized)) {
      refs.push({ column, value: normalized });
    }
  };

  pushRef('provider_subscription_id', event.subscriptionId);
  pushRef('provider_customer_id', event.customerId);
  pushRef('purchase_id', event.purchaseId);
  pushRef('provider_subscription_id', event.providerOrderId);
  if (event.providerId === 'stripe') {
    pushRef('stripe_subscription_id', event.subscriptionId);
    pushRef('stripe_customer_id', event.customerId);
  }
  if (refs.length === 0) return null;

  const where = refs.map((ref) => `${ref.column} = ?`).join(' OR ');
  const row = await db
    .prepare(`SELECT user_id FROM subscriptions WHERE provider = ? AND (${where}) LIMIT 1`)
    .bind(provider, ...refs.map((ref) => ref.value))
    .first();
  return row?.user_id ? String(row.user_id) : null;
}

async function syncSubscriptionNewsletter(db: any, userId: string, status: string, env: any) {
  try {
    await syncNewsletterForSubscription(db, userId, status, env);
  } catch (brevoErr) {
    console.error('[payments webhook] syncNewsletterForSubscription failed', {
      fn: 'syncNewsletterForSubscription',
      userId,
      status,
      err: brevoErr,
    });
  }
}

async function updateSubscriptionStatusByProviderRef(
  db: any,
  event: Pick<
    NormalizedPaymentEvent,
    'providerId' | 'subscriptionId' | 'customerId' | 'purchaseId' | 'providerOrderId'
  >,
  nextStatus: SubscriptionStatus,
) {
  const provider = providerIdToDbProvider(event.providerId);
  const refs: Array<{ column: string; value: string }> = [];
  const pushRef = (column: string, value: unknown) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return;
    if (!refs.some((ref) => ref.column === column && ref.value === normalized)) {
      refs.push({ column, value: normalized });
    }
  };

  pushRef('provider_subscription_id', event.subscriptionId);
  pushRef('provider_subscription_id', event.providerOrderId);
  pushRef('provider_customer_id', event.customerId);
  pushRef('purchase_id', event.purchaseId);
  if (event.providerId === 'stripe') {
    pushRef('stripe_subscription_id', event.subscriptionId);
    pushRef('stripe_customer_id', event.customerId);
  }
  if (refs.length === 0) return;

  const where = refs.map((ref) => `${ref.column} = ?`).join(' OR ');
  const cancelClause =
    nextStatus === 'cancelled' ? ', cancel_at_period_end = 0' : '';
  await db
    .prepare(
      `UPDATE subscriptions
       SET status = ?, updated_at = CURRENT_TIMESTAMP${cancelClause}
       WHERE provider = ? AND (${where})`,
    )
    .bind(nextStatus, provider, ...refs.map((ref) => ref.value))
    .run();
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/account/pricing — PUBLIC
 * Returns the display prices (EUR) from admin_settings.
 */
export async function handleGetPricing(request: any, env: any, corsHeaders: any) {
  try {
    const [
      stripePricing,
      legacyPricing,
      gopayPricing,
      comgatePricing,
      gopayCurrency,
      comgateCurrency,
      allowedPlans,
      { enabled, runnable },
      providerOrder,
    ] = await Promise.all([
      getEffectivePricingSettings(env, 'stripe'),
      getEffectivePricingSettings(env, 'legacy'),
      getEffectivePricingSettings(env, 'gopay'),
      getEffectivePricingSettings(env, 'comgate'),
      getSetting(env, 'gopay_currency', { defaultValue: 'CZK', ttlSeconds: 300 }),
      getSetting(env, 'comgate_currency', { defaultValue: 'CZK', ttlSeconds: 300 }),
      getAllowedPlans(env),
      getPaymentProviders(env),
      getPaymentProviderOrder(env).then((ids) => toSupportedApiProviderIds(ids)),
    ]);
    const enabledProviders = resolvePublicEnabledProviders(enabled, runnable);
    const primaryPricing = enabledProviders.includes('stripe')
      ? stripePricing
      : enabledProviders.includes('gopay')
        ? gopayPricing
        : enabledProviders.includes('comgate')
          ? comgatePricing
          : enabledProviders.includes('legacy')
            ? legacyPricing
            : stripePricing;
    const pricingNotConfigured =
      (allowedPlans.includes('monthly') && primaryPricing.monthly == null) ||
      (allowedPlans.includes('yearly') && primaryPricing.yearly == null) ||
      (allowedPlans.includes('club') && primaryPricing.club == null);
    const payload = {
      monthly: allowedPlans.includes('monthly') ? primaryPricing.monthly : null,
      yearly: allowedPlans.includes('yearly') ? primaryPricing.yearly : null,
      club: allowedPlans.includes('club') ? primaryPricing.club : null,
      allowedPlans,
      pricesByProvider: {
        stripe: stripePricing,
        legacy: legacyPricing,
        gopay: gopayPricing,
        comgate: comgatePricing,
      },
      gopayCurrency:
        String(gopayCurrency ?? 'CZK')
          .trim()
          .toUpperCase() || 'CZK',
      comgateCurrency:
        String(comgateCurrency ?? 'CZK')
          .trim()
          .toUpperCase() || 'CZK',
      // Empty when only stubs/unsupported providers remain — never invent Stripe.
      enabledProviders,
      providerOrder,
      legacyConfigured: isLegacyCheckoutConfigured(env),
      gopayConfigured: isGoPayConfigured(env),
      comgateConfigured: isComgateConfigured(env),
      ...(pricingNotConfigured || enabledProviders.length === 0
        ? { pricing_not_configured: true }
        : {}),
    };
    return jsonResponse(payload, 200, corsHeaders);
  } catch (err) {
    console.error('handleGetPricing error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

function parseCsvList(input: unknown, allowValues: string[]) {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim().toLowerCase()).filter((v) => allowValues.includes(v));
  }
  return String(input ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => allowValues.includes(v));
}

function parseOptionalPositiveNumber(input: unknown) {
  if (input === '' || input == null) return '';
  const numeric = parseLocaleNumber(input);
  if (numeric == null || numeric <= 0) {
    throw new Error('Prices must be positive numbers');
  }
  return String(numeric);
}

export async function handleAdminPaymentSettings(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin');
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
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
      'legacy_monthly_price_eur',
      'legacy_yearly_price_eur',
      'legacy_club_price_eur',
      'gopay_monthly_price',
      'gopay_yearly_price',
      'gopay_club_price',
      'gopay_currency',
      'comgate_monthly_price',
      'comgate_yearly_price',
      'comgate_club_price',
      'comgate_currency',
      'stripe_price_monthly',
      'stripe_price_yearly',
      'stripe_price_club',
    ] as const;
    const values = await Promise.all(keys.map((key) => getSetting(env, key)));
    const valueByKey = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    return jsonResponse(
      {
        enabledProviders: parseCsvList(valueByKey.payments_enabled_providers ?? 'stripe', [
          'stripe',
          'legacy',
          'gopay',
          'comgate',
        ]),
        providerOrder: parseCsvList(valueByKey.payment_provider_order ?? 'stripe,legacy', [
          'stripe',
          'legacy',
          'gopay',
          'comgate',
        ]),
        allowedPlans: parseCsvList(valueByKey.allowed_plans ?? 'monthly,yearly,club', [
          'monthly',
          'yearly',
          'club',
        ]),
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
          legacy: {
            monthly: valueByKey.legacy_monthly_price_eur ?? '',
            yearly: valueByKey.legacy_yearly_price_eur ?? '',
            club: valueByKey.legacy_club_price_eur ?? '',
          },
          gopay: {
            monthly: valueByKey.gopay_monthly_price ?? '',
            yearly: valueByKey.gopay_yearly_price ?? '',
            club: valueByKey.gopay_club_price ?? '',
          },
          comgate: {
            monthly: valueByKey.comgate_monthly_price ?? '',
            yearly: valueByKey.comgate_yearly_price ?? '',
            club: valueByKey.comgate_club_price ?? '',
          },
        },
        gopayCurrency: valueByKey.gopay_currency ?? 'CZK',
        comgateCurrency: valueByKey.comgate_currency ?? 'CZK',
        gopayConfigured: isGoPayConfigured(env),
        comgateConfigured: isComgateConfigured(env),
        stripePriceIds: {
          monthly: valueByKey.stripe_price_monthly ?? '',
          yearly: valueByKey.stripe_price_yearly ?? '',
          club: valueByKey.stripe_price_club ?? '',
        },
      },
      200,
      corsHeaders,
    );
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Request body is required' }, 400, corsHeaders);
  }

  try {
    const enabledProviders = parseCsvList(body.enabledProviders ?? 'stripe', [
      'stripe',
      'legacy',
      'gopay',
      'comgate',
    ]);
    if (!enabledProviders.length) {
      return jsonResponse(
        { error: 'At least one payment provider must be enabled' },
        400,
        corsHeaders,
      );
    }
    const providerOrder = parseCsvList(body.providerOrder ?? enabledProviders, [
      'stripe',
      'legacy',
      'gopay',
      'comgate',
    ]);
    const allowedPlans = parseCsvList(body.allowedPlans ?? 'monthly,yearly,club', [
      'monthly',
      'yearly',
      'club',
    ]);
    const basePrices = body.basePrices ?? {};
    const providerPrices = body.providerPrices ?? {};
    const stripePriceIds = body.stripePriceIds ?? {};

    const updates: [string, string][] = [
      ['payments_enabled_providers', enabledProviders.join(',')],
      ['payment_provider_order', providerOrder.join(',')],
      [
        'allowed_plans',
        (allowedPlans.length ? allowedPlans : ['monthly', 'yearly', 'club']).join(','),
      ],
      ['monthly_price_eur', parseOptionalPositiveNumber(basePrices.monthly)],
      ['yearly_price_eur', parseOptionalPositiveNumber(basePrices.yearly)],
      ['club_price_eur', parseOptionalPositiveNumber(basePrices.club)],
      ['stripe_monthly_price_eur', parseOptionalPositiveNumber(providerPrices?.stripe?.monthly)],
      ['stripe_yearly_price_eur', parseOptionalPositiveNumber(providerPrices?.stripe?.yearly)],
      ['stripe_club_price_eur', parseOptionalPositiveNumber(providerPrices?.stripe?.club)],
      ['legacy_monthly_price_eur', parseOptionalPositiveNumber(providerPrices?.legacy?.monthly)],
      ['legacy_yearly_price_eur', parseOptionalPositiveNumber(providerPrices?.legacy?.yearly)],
      ['legacy_club_price_eur', parseOptionalPositiveNumber(providerPrices?.legacy?.club)],
      ['gopay_monthly_price', parseOptionalPositiveNumber(providerPrices?.gopay?.monthly)],
      ['gopay_yearly_price', parseOptionalPositiveNumber(providerPrices?.gopay?.yearly)],
      ['gopay_club_price', parseOptionalPositiveNumber(providerPrices?.gopay?.club)],
      [
        'gopay_currency',
        String(body.gopayCurrency ?? 'CZK')
          .trim()
          .toUpperCase() || 'CZK',
      ],
      ['comgate_monthly_price', parseOptionalPositiveNumber(providerPrices?.comgate?.monthly)],
      ['comgate_yearly_price', parseOptionalPositiveNumber(providerPrices?.comgate?.yearly)],
      ['comgate_club_price', parseOptionalPositiveNumber(providerPrices?.comgate?.club)],
      [
        'comgate_currency',
        String(body.comgateCurrency ?? 'CZK')
          .trim()
          .toUpperCase() || 'CZK',
      ],
      ['stripe_price_monthly', String(stripePriceIds.monthly ?? '').trim()],
      ['stripe_price_yearly', String(stripePriceIds.yearly ?? '').trim()],
      ['stripe_price_club', String(stripePriceIds.club ?? '').trim()],
    ];

    await setSettings(env, updates);
    return jsonResponse({ ok: true }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid settings';
    return jsonResponse({ error: message }, 400, corsHeaders);
  }
}

function slugifyPlanLabel(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'plan'
  );
}

/**
 * GET /api/admin/payments/plans — list configurable subscription plans
 * PATCH — update or create a plan row
 */
export async function handleAdminPaymentPlans(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin');
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (request.method === 'GET') {
    const plans = await buildAdminPlanList(env);
    const [legacyManageUrl, legacyProviderName, legacyShowManageButton, legacyConfigured] =
      await Promise.all([
        getSetting(env, 'legacy_manage_subscription_url', { ttlSeconds: 300 }),
        getSetting(env, 'legacy_provider_name', { ttlSeconds: 300 }),
        getSetting(env, 'legacy_show_manage_button', { ttlSeconds: 300 }),
        Promise.resolve(isLegacyCheckoutConfigured(env)),
      ]);
    return jsonResponse(
      {
        plans,
        legacy: {
          configured: legacyConfigured,
          hasWebhookSecret: isLegacyWebhookConfigured(env),
          manageSubscriptionUrl: String(legacyManageUrl ?? ''),
          providerName: String(legacyProviderName ?? ''),
          showManageButton: String(legacyShowManageButton ?? '0') === '1',
        },
      },
      200,
      corsHeaders,
    );
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Request body is required' }, 400, corsHeaders);
  }

  try {
    if (body.legacy && typeof body.legacy === 'object') {
      const legacy = body.legacy;
      const updates: [string, string][] = [];
      if (typeof legacy.manageSubscriptionUrl === 'string') {
        updates.push(['legacy_manage_subscription_url', legacy.manageSubscriptionUrl.trim()]);
      }
      if (typeof legacy.providerName === 'string') {
        updates.push(['legacy_provider_name', legacy.providerName.trim()]);
      }
      if (typeof legacy.showManageButton === 'boolean') {
        updates.push(['legacy_show_manage_button', legacy.showManageButton ? '1' : '0']);
      }
      if (updates.length) await setSettings(env, updates);
    }

    const plan = body.plan;
    if (plan && typeof plan === 'object') {
      let id = typeof plan.id === 'string' ? plan.id.trim().toLowerCase() : '';
      if (!id && typeof plan.label === 'string') id = slugifyPlanLabel(plan.label);
      if (!id)
        return jsonResponse({ error: 'plan.id or plan.label is required' }, 400, corsHeaders);

      const updates: [string, string][] = [];
      if (typeof plan.label === 'string' && plan.label.trim()) {
        updates.push([`${id}_label`, plan.label.trim()]);
      }
      if (typeof plan.stripePriceId === 'string') {
        updates.push([`stripe_price_${id}`, plan.stripePriceId.trim()]);
      }
      if (plan.amountEur != null && plan.amountEur !== '') {
        updates.push([`${id}_price_eur`, parseOptionalPositiveNumber(plan.amountEur)]);
      }
      if (typeof plan.interval === 'string' && plan.interval.trim()) {
        updates.push([`${id}_interval`, plan.interval.trim()]);
      }
      if (typeof plan.enabled === 'boolean') {
        updates.push([`${id}_enabled`, plan.enabled ? '1' : '0']);
      }

      if (!updates.length) {
        return jsonResponse({ error: 'No plan fields to update' }, 400, corsHeaders);
      }

      const allowedRaw = await getSetting(env, 'allowed_plans', {
        defaultValue: 'monthly,yearly,club',
      });
      const allowed = parseCsvList(allowedRaw ?? 'monthly,yearly,club', [
        'monthly',
        'yearly',
        'club',
      ]);
      if (
        !allowed.includes(id) &&
        CORE_PLAN_SLUGS.includes(id as (typeof CORE_PLAN_SLUGS)[number])
      ) {
        // core plan — ok
      } else if (
        !allowed.includes(id) &&
        !CORE_PLAN_SLUGS.includes(id as (typeof CORE_PLAN_SLUGS)[number])
      ) {
        const nextAllowed = [...allowed, id];
        updates.push(['allowed_plans', nextAllowed.join(',')]);
      }

      await setSettings(env, updates);
    }

    const plans = await buildAdminPlanList(env);
    return jsonResponse({ ok: true, plans }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid plan';
    return jsonResponse({ error: message }, 400, corsHeaders);
  }
}

function normalizeReturnPath(input: unknown, fallback = '/account'): string {
  const raw = String(input ?? fallback).trim();
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  const [beforeHash = ''] = raw.split('#');
  const [pathOnly = ''] = beforeHash.split('?');
  return pathOnly || fallback;
}

/**
 * GET /api/payments/stripe-config — PUBLIC
 * Returns the Stripe publishable key for client-side Elements.
 */
export async function handleGetStripeConfig(_request: any, env: any, corsHeaders: any) {
  const publishableKey = String(env.STRIPE_PUBLISHABLE_KEY ?? '').trim();
  if (!publishableKey) {
    return jsonResponse(
      {
        error: 'Stripe is not configured on the server.',
        code: 'stripe_not_configured',
      },
      503,
      corsHeaders,
    );
  }
  return jsonResponse({ publishableKey }, 200, corsHeaders);
}

/**
 * GET /api/payments/session-status?session_id=cs_... — protected
 * Returns Checkout Session status after embedded checkout return.
 */
export async function handleSessionStatus(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get('session_id') ?? '').trim();
  if (!sessionId.startsWith('cs_')) {
    return jsonResponse({ error: 'session_id is required' }, 400, corsHeaders);
  }

  try {
    const session = await stripeGet(
      `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent&expand[]=subscription`,
      env,
    );
    if (session.error) {
      console.error('Stripe session retrieve error:', session.error);
      return jsonResponse({ error: 'Failed to retrieve checkout session' }, 502, corsHeaders);
    }

    const sessionUserId = String(session.metadata?.userId ?? '').trim();
    if (!sessionUserId || sessionUserId !== user.sub) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const paymentIntent =
      session.payment_intent && typeof session.payment_intent === 'object'
        ? session.payment_intent
        : null;
    const subscription =
      session.subscription && typeof session.subscription === 'object'
        ? session.subscription
        : null;

    return jsonResponse(
      {
        status: session.status ?? null,
        paymentStatus: session.payment_status ?? null,
        paymentIntentId: paymentIntent?.id ?? null,
        paymentIntentStatus: paymentIntent?.status ?? null,
        subscriptionId:
          subscription?.id ??
          (typeof session.subscription === 'string' ? session.subscription : null),
        subscriptionStatus: subscription?.status ?? null,
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error('handleSessionStatus error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

/**
 * POST /api/payments/checkout — protected
 * Body: { planType: 'monthly'|'yearly'|'club', provider?, promoCode?, returnPath? }
 * Stripe: embedded Checkout Session (ui_mode elements) → { clientSecret }.
 */
export async function handleCheckout(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const allowedPlans = await getAllowedPlans(env);
  if (!body?.planType || !allowedPlans.includes(body.planType)) {
    return jsonResponse(
      { error: `planType must be one of: ${allowedPlans.join(', ')}` },
      400,
      corsHeaders,
    );
  }
  const planType = normalizePlanType(body.planType);

  try {
    const db = getDb(env);
    const { providers, enabled, runnable } = await getPaymentProviders(env);
    const providerOrder = await getPaymentProviderOrder(env);
    const orderedRunnable = [
      ...providerOrder.filter((p) => runnable.includes(p)),
      ...runnable.filter((p) => !providerOrder.includes(p)),
    ];
    const selectedRaw = String(body?.provider ?? '')
      .trim()
      .toLowerCase();
    const selectedId =
      fromApiProviderId(selectedRaw) ??
      fromApiProviderId(selectedRaw === 'legacy' ? 'qerko' : selectedRaw);
    // Recognized stub aliases (gopay/comgate) must not silently fall back to another provider.
    if (selectedId && toApiProviderId(selectedId) === null) {
      return jsonResponse(
        {
          error: 'Requested payment provider is not supported.',
          code: 'provider_not_supported',
        },
        400,
        corsHeaders,
      );
    }
    // Explicit supported selection wins when present in order; otherwise fall back only when
    // the client omitted the provider or sent an unrecognized value.
    const providerId: PaymentProviderId | null =
      selectedId && providerOrder.includes(selectedId) ? selectedId : (orderedRunnable[0] ?? null);
    const apiProvider = providerId ? toApiProviderId(providerId) : null;
    if (!providerId || !apiProvider) {
      const noneAvailable = orderedRunnable.length === 0;
      return jsonResponse(
        {
          error: noneAvailable
            ? 'No payment provider is available. Check admin payment settings.'
            : 'Requested payment provider is not supported.',
          code: noneAvailable ? 'provider_not_configured' : 'provider_not_supported',
        },
        noneAvailable ? 503 : 400,
        corsHeaders,
      );
    }
    const provider = providers.get(providerId);

    const promoResolution =
      providerId === 'stripe'
        ? await resolvePromoCodeForCheckout(env, body?.promoCode, planType, 'stripe')
        : { ok: false, reason: 'empty' };
    const promoMeta = promoResolution.ok ? promoResolution.checkoutMeta : null;
    if (!promoResolution.ok && promoResolution.reason !== 'empty') {
      return jsonResponse(
        {
          error: promoResolution.error ?? 'Promo code is not valid',
          code: promoResolution.reason ?? 'invalid_promo',
        },
        promoResolution.status ?? 400,
        corsHeaders,
      );
    }

    if (!enabled.includes(providerId)) {
      return jsonResponse(
        {
          error: 'Requested payment provider is not enabled.',
          code: 'provider_not_enabled',
        },
        400,
        corsHeaders,
      );
    }
    if (!provider || !runnable.includes(providerId)) {
      return jsonResponse(
        {
          error:
            'Bank payments are temporarily unavailable. Please choose another payment method or try again later.',
          code: 'provider_not_configured',
        },
        503,
        corsHeaders,
      );
    }

    if (!provider.capabilities.newSubscriptions) {
      const legacyRelink = await db
        .prepare(`
        SELECT purchase_id FROM subscriptions
        WHERE user_id = ? AND provider = 'legacy' AND status = 'needs_relink'
          AND purchase_id IS NOT NULL AND trim(purchase_id) <> ''
        ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
        LIMIT 1
      `)
        .bind(user.sub)
        .first();
      const bodyPurchaseId = String(body?.purchaseId ?? '').trim();
      if (!legacyRelink && !bodyPurchaseId) {
        return jsonResponse(
          {
            error: 'This payment provider is only available for migrated subscriptions.',
            code: 'provider_migration_only',
          },
          400,
          corsHeaders,
        );
      }
    }

    // Guard: don't create a new checkout session if the user already has an
    // active or trialing subscription. Return a 409 pointing them to the portal.
    const existingSub = await db
      .prepare(`
      SELECT id FROM subscriptions
      WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due')
      LIMIT 1
    `)
      .bind(user.sub)
      .first();
    if (existingSub) {
      return jsonResponse(
        {
          error: 'You already have an active subscription. Use the customer portal to manage it.',
          code: 'subscription_exists',
        },
        409,
        corsHeaders,
      );
    }

    const returnPath = normalizeReturnPath(body?.returnPath);
    const session = await provider.createCheckoutSession({
      userId: user.sub,
      email: user.email,
      planType,
      returnPath,
      ...(typeof body?.purchaseId === 'string' ? { purchaseId: body.purchaseId } : {}),
      ...(promoMeta
        ? {
            promo: {
              stripeCouponId: promoMeta.stripeCouponId,
              metadata: {
                promoCodeId: promoMeta.promoCodeId ?? '',
                promoCode: promoMeta.promoCode ?? '',
                promoRewardType: promoMeta.rewardType ?? '',
              },
            },
          }
        : {}),
    });

    if (session.clientSecret) {
      return jsonResponse(
        { clientSecret: session.clientSecret, provider: apiProvider },
        200,
        corsHeaders,
      );
    }
    if (session.checkoutUrl) {
      if (apiProvider === 'comgate') {
        // Comgate cannot carry free-form metadata on the payment object. Persist a
        // pending payment_checkout_sessions row (table from migration 0010) so the
        // webhook can resolve userId/planType on first purchase.
        const refId = String(session.metadata?.refId ?? '').trim();
        const orderId = String(session.orderId ?? '').trim();
        if (!refId || !orderId) {
          return jsonResponse(
            {
              error: 'Failed to create checkout session',
              code: 'checkout_session_persist_failed',
            },
            502,
            corsHeaders,
          );
        }
        await db
          .prepare(
            `INSERT INTO payment_checkout_sessions (
              id, user_id, provider, plan_type, checkout_token, provider_checkout_id, status,
              created_at, updated_at
            ) VALUES (?, ?, 'comgate', ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(crypto.randomUUID(), user.sub, planType, refId, orderId)
          .run();
      }
      return jsonResponse(
        {
          checkoutUrl: session.checkoutUrl,
          provider: apiProvider,
          orderId: session.orderId,
        },
        200,
        corsHeaders,
      );
    }

    return jsonResponse(
      {
        error: 'Failed to create checkout session',
        code: 'checkout_failed',
      },
      502,
      corsHeaders,
    );
  } catch (err: unknown) {
    console.error('handleCheckout error:', err);
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    const statusRaw =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status?: number }).status)
        : NaN;
    if (code === 'stripe_timeout' || code === 'gopay_timeout' || code === 'comgate_timeout') {
      return jsonResponse(
        { error: 'Payment provider timed out. Please try again.', code },
        504,
        corsHeaders,
      );
    }
    const rawMessage = err instanceof Error ? err.message : '';
    const configLeak = looksLikePaymentConfigLeak(rawMessage);
    if (
      code === 'legacy_not_configured' ||
      code === 'provider_not_configured' ||
      configLeak
    ) {
      return jsonResponse(
        {
          error: CUSTOMER_SAFE_BANK_PAYMENTS_UNAVAILABLE,
          code: code || 'provider_not_configured',
        },
        Number.isFinite(statusRaw) && statusRaw >= 400 ? statusRaw : 503,
        corsHeaders,
      );
    }
    if (code && rawMessage && Number.isFinite(statusRaw) && statusRaw >= 400 && statusRaw < 500) {
      return jsonResponse({ error: rawMessage, code }, statusRaw, corsHeaders);
    }
    if (code && rawMessage && Number.isFinite(statusRaw) && statusRaw >= 500) {
      return jsonResponse(
        {
          error: configLeak ? CUSTOMER_SAFE_BANK_PAYMENTS_UNAVAILABLE : rawMessage,
          code,
        },
        statusRaw,
        corsHeaders,
      );
    }
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

/**
 * POST /api/payments/webhook[/provider] — NO auth
 * Verifies the provider signature, normalizes the provider event, and then
 * handles subscription lifecycle changes through provider-agnostic event types.
 */
export async function handleWebhook(
  request: any,
  env: any,
  corsHeaders: any,
  providerId: PaymentProviderId = 'stripe',
  ctx?: PostHogWaitUntilCtx,
) {
  const rawBody = await request.text();
  const { providers } = await getPaymentProviders(env);
  const provider = providers.get(providerId);
  if (!provider) {
    return jsonResponse({ error: 'Payment provider not configured' }, 503, corsHeaders);
  }
  const sigHeader =
    providerId === 'stripe'
      ? (request.headers.get('Stripe-Signature') ?? '')
      : providerId === 'qerko'
        ? (request.headers.get('X-Legacy-Signature') ??
          request.headers.get('X-Webhook-Signature') ??
          request.headers.get('Authorization') ??
          '')
        : '';
  const valid = await provider.verifyWebhookSignature(rawBody, sigHeader);
  if (!valid) {
    return jsonResponse({ error: 'Invalid webhook signature' }, 400, corsHeaders);
  }

  let normalizedEvent: NormalizedPaymentEvent;
  try {
    normalizedEvent = await provider.handleWebhook(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  try {
    const db = getDb(env);
    switch (normalizedEvent.type) {
      case 'checkout.completed':
      case 'subscription.created':
      case 'subscription.updated':
      case 'invoice.paid': {
        const userId = await upsertSubscriptionFromNormalizedEvent(db, env, normalizedEvent);
        if (!userId) break;

        const newsletterStatus =
          normalizedEvent.providerId === 'stripe' &&
          (normalizedEvent.type === 'subscription.created' ||
            normalizedEvent.type === 'subscription.updated')
            ? String(getNormalizedRawObject(normalizedEvent).status ?? normalizedEvent.status ?? '')
            : String(normalizedEvent.status ?? 'active');
        if (newsletterStatus) {
          await syncSubscriptionNewsletter(db, userId, newsletterStatus, env);
        }

        if (
          normalizedEvent.type === 'checkout.completed' &&
          normalizedEvent.providerId === 'stripe' &&
          normalizedEvent.promoCodeId?.trim() &&
          normalizedEvent.userId &&
          normalizedEvent.subscriptionId
        ) {
          const stripeSub = await stripeGet(
            `/subscriptions/${normalizedEvent.subscriptionId}`,
            env,
          );
          if (stripeSub.id) {
            await applyPromoRedemption(env, {
              promoCodeId: normalizedEvent.promoCodeId.trim(),
              userId: normalizedEvent.userId,
              provider: 'stripe',
              planType: String(normalizedEvent.planType || 'monthly'),
              providerSubscriptionId: String(stripeSub.id),
              grantedUntil: stripeSubscriptionPeriodEndIso(stripeSub),
            });
          }
        }

        if (normalizedEvent.type === 'invoice.paid') {
          await handlePaymentInvoicePaid(env, db, userId, normalizedEvent);
        }
        captureStripeWebhookPostHog(env, normalizedEvent, userId, ctx);
        break;
      }
      case 'subscription.deleted':
      case 'subscription.past_due': {
        const nextStatus: SubscriptionStatus =
          normalizedEvent.type === 'subscription.deleted' ? 'cancelled' : 'past_due';
        const userId = await findUserIdForPaymentEvent(db, normalizedEvent);
        await updateSubscriptionStatusByProviderRef(db, normalizedEvent, nextStatus);
        if (userId) {
          try {
            await removeSubscriberFromNewsletter(db, userId, env);
          } catch (brevoErr) {
            console.error('[payments webhook] removeSubscriberFromNewsletter failed', {
              fn: 'removeSubscriberFromNewsletter',
              userId,
              err: brevoErr,
            });
          }
          try {
            // Intentional grace period: past_due keeps offline licenses through Stripe
            // smart-retries / Qerko retry windows; revoke only on cancellation.
            if (nextStatus === 'cancelled') {
              await revokeOfflineLicensesForUser(db, userId, 'subscription_cancelled');
            }
          } catch (offlineErr) {
            console.error('[payments webhook] revokeOfflineLicensesForUser failed', {
              fn: 'revokeOfflineLicensesForUser',
              userId,
              err: offlineErr,
            });
            throw offlineErr;
          }
          captureStripeWebhookPostHog(env, normalizedEvent, userId, ctx);
        }
        break;
      }
      default:
        // Unhandled event type — acknowledge receipt so providers don't retry forever.
        break;
    }

    return jsonResponse({ ok: true }, 200, corsHeaders);
  } catch (err) {
    console.error('handleWebhook error:', err);
    capturePostHogException(env, err, {
      ...(ctx ? { ctx } : {}),
      properties: { handler: 'payments_webhook', providerId },
    });
    // Return 500 so Stripe retries the event on transient failures
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

/**
 * GET /api/account/subscription — protected
 * Returns the most recent subscription row for the authenticated user.
 */
/**
 * GET /api/payments/webhook/gopay?id=&parent_id= — NO auth (GoPay calls this)
 * Notifications are unsigned; we re-fetch payment status with merchant credentials.
 */
export async function handleGoPayWebhook(request: any, env: any, corsHeaders: any) {
  const url = new URL(request.url);
  const paymentId = String(url.searchParams.get('id') ?? '').trim();
  const parentId = String(url.searchParams.get('parent_id') ?? '').trim();
  if (!paymentId) {
    return jsonResponse({ error: 'Missing payment id' }, 400, corsHeaders);
  }

  const { providers } = await getPaymentProviders(env);
  let gopayProvider = providers.get('gopay');
  if (!gopayProvider) {
    // Notification may arrive even if gopay is temporarily disabled in settings —
    // still process when credentials exist.
    const config = buildPaymentsConfig(env);
    if (!config.gopay) {
      return jsonResponse({ error: 'GoPay provider not configured' }, 503, corsHeaders);
    }
    const forced = createEnabledProviders(['gopay'], config);
    gopayProvider = forced.get('gopay');
  }
  if (!gopayProvider || !gopayProvider.isConfigured()) {
    return jsonResponse({ error: 'GoPay provider not configured' }, 503, corsHeaders);
  }

  const rawBody = JSON.stringify({
    id: paymentId,
    ...(parentId ? { parent_id: parentId } : {}),
  });
  const valid = await gopayProvider.verifyWebhookSignature(rawBody, '');
  if (!valid) {
    return jsonResponse({ error: 'GoPay credentials missing' }, 400, corsHeaders);
  }

  try {
    const event = await gopayProvider.handleWebhook(rawBody);
    const db = getDb(env);
    const planType = normalizePlanType(String(event.planType ?? 'monthly'));
    const subscriptionId = String(event.subscriptionId ?? '').trim();
    const userId = String(event.userId ?? '').trim();

    if (event.type === 'checkout.completed' || event.type === 'subscription.created') {
      if (!userId || !subscriptionId) {
        return jsonResponse({ ok: true, ignored: true }, 200, corsHeaders);
      }
      await upsertSubscriptionRow(db, {
        userId,
        planType,
        status: 'active',
        provider: 'gopay',
        providerSubscriptionId: subscriptionId,
        providerCustomerId: userId,
        currentPeriodEnd: periodEndIsoForPlan(planType),
      });
      try {
        await syncSubscriptionNewsletter(db, userId, 'active', env);
      } catch (brevoErr) {
        console.error('[gopay webhook] newsletter sync failed', { userId, err: brevoErr });
      }
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    if (event.type === 'invoice.paid' || event.type === 'payment.succeeded') {
      if (!subscriptionId) {
        return jsonResponse({ ok: true, ignored: true }, 200, corsHeaders);
      }
      const existing = await db
        .prepare(
          `SELECT user_id, plan_type FROM subscriptions
           WHERE provider = 'gopay' AND provider_subscription_id = ? LIMIT 1`,
        )
        .bind(subscriptionId)
        .first();
      if (existing?.user_id) {
        const existingPlan = normalizePlanType(String(existing.plan_type ?? planType));
        await upsertSubscriptionRow(db, {
          userId: String(existing.user_id),
          planType: existingPlan,
          status: 'active',
          provider: 'gopay',
          providerSubscriptionId: subscriptionId,
          providerCustomerId: String(existing.user_id),
          currentPeriodEnd: periodEndIsoForPlan(existingPlan),
        });
        try {
          await syncSubscriptionNewsletter(db, String(existing.user_id), 'active', env);
        } catch (brevoErr) {
          console.error('[gopay webhook] newsletter sync failed', {
            userId: existing.user_id,
            err: brevoErr,
          });
        }
      }
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    if (event.type === 'payment.failed' || event.type === 'subscription.past_due') {
      if (subscriptionId) {
        const existing = await db
          .prepare(
            `SELECT user_id FROM subscriptions
             WHERE provider = 'gopay' AND provider_subscription_id = ? LIMIT 1`,
          )
          .bind(subscriptionId)
          .first();
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
             WHERE provider = 'gopay' AND provider_subscription_id = ?`,
          )
          .bind(subscriptionId)
          .run();
        if (existing?.user_id) {
          try {
            await removeSubscriberFromNewsletter(db, existing.user_id, env);
          } catch (brevoErr) {
            console.error('[gopay webhook] newsletter remove failed', {
              userId: existing.user_id,
              err: brevoErr,
            });
          }
          try {
            await revokeOfflineLicensesForUser(db, existing.user_id, 'subscription_past_due');
          } catch (offlineErr) {
            console.error('[gopay webhook] offline revoke failed', {
              userId: existing.user_id,
              err: offlineErr,
            });
            throw offlineErr;
          }
        }
      }
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    if (event.type === 'subscription.deleted') {
      if (subscriptionId) {
        const row = await db
          .prepare(
            `SELECT user_id FROM subscriptions
             WHERE provider = 'gopay' AND provider_subscription_id = ? LIMIT 1`,
          )
          .bind(subscriptionId)
          .first();
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE provider = 'gopay' AND provider_subscription_id = ?`,
          )
          .bind(subscriptionId)
          .run();
        if (row?.user_id) {
          try {
            await removeSubscriberFromNewsletter(db, row.user_id, env);
          } catch (brevoErr) {
            console.error('[gopay webhook] newsletter remove failed', {
              userId: row.user_id,
              err: brevoErr,
            });
          }
          try {
            await revokeOfflineLicensesForUser(db, row.user_id, 'subscription_cancelled');
          } catch (offlineErr) {
            console.error('[gopay webhook] offline revoke failed', {
              userId: row.user_id,
              err: offlineErr,
            });
            throw offlineErr;
          }
        }
      }
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    return jsonResponse({ ok: true, ignored: true }, 200, corsHeaders);
  } catch (err) {
    console.error('handleGoPayWebhook error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

/**
 * POST /api/payments/webhook/comgate — NO auth (Comgate calls this)
 * Notifications include `secret` for verification; status is re-verified via API.
 * Must reply `code=0&message=OK`.
 */
export async function handleComgateWebhook(request: any, env: any, corsHeaders: any) {
  const rawBody = await request.text();
  const { providers } = await getPaymentProviders(env);
  let comgateProvider = providers.get('comgate');
  if (!comgateProvider) {
    const config = buildPaymentsConfig(env);
    if (!config.comgate) {
      return new Response('code=0&message=OK', {
        status: 200,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...corsHeaders },
      });
    }
    const forced = createEnabledProviders(['comgate'], config);
    comgateProvider = forced.get('comgate');
  }
  if (!comgateProvider || !comgateProvider.isConfigured()) {
    return new Response('code=0&message=OK', {
      status: 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...corsHeaders },
    });
  }

  const valid = await comgateProvider.verifyWebhookSignature(rawBody, '');
  if (!valid) {
    return new Response('code=1400&message=invalid secret', {
      status: 400,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...corsHeaders },
    });
  }

  try {
    const event = await comgateProvider.handleWebhook(rawBody);
    const db = getDb(env);
    const subscriptionId = String(event.subscriptionId ?? '').trim();
    const purchaseId = String(event.purchaseId ?? '').trim();

    if (event.type === 'checkout.completed' || event.type === 'invoice.paid') {
      if (!subscriptionId) {
        return new Response('code=0&message=OK', {
          status: 200,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...corsHeaders },
        });
      }

      const identity = await resolveComgateCheckoutIdentity(db, {
        subscriptionId,
        purchaseId,
      });

      if (identity?.userId) {
        await upsertSubscriptionRow(db, {
          userId: identity.userId,
          planType: identity.planType,
          status: 'active',
          provider: 'comgate',
          providerSubscriptionId: subscriptionId,
          providerCustomerId: identity.userId,
          currentPeriodEnd: periodEndIsoForPlan(identity.planType),
        });
        if (identity.fromPendingSession && identity.pendingSessionId) {
          await db
            .prepare(
              `UPDATE payment_checkout_sessions
               SET status = 'completed',
                   provider_subscription_id = ?,
                   completed_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND status = 'pending'`,
            )
            .bind(subscriptionId, identity.pendingSessionId)
            .run();
        }
        try {
          await syncSubscriptionNewsletter(db, identity.userId, 'active', env);
        } catch (brevoErr) {
          console.error('[comgate webhook] newsletter sync failed', {
            userId: identity.userId,
            err: brevoErr,
          });
        }
      } else {
        console.warn('[comgate webhook] checkout completed without resolvable user', {
          subscriptionId,
          purchaseId,
        });
      }
    }

    // Match GoPay / Stripe: failed renewals enter a grace period (past_due), not
    // immediate cancellation.
    if (event.type === 'payment.failed') {
      if (subscriptionId) {
        const existing = await db
          .prepare(
            `SELECT user_id FROM subscriptions
             WHERE provider = 'comgate' AND provider_subscription_id = ? LIMIT 1`,
          )
          .bind(subscriptionId)
          .first();
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
             WHERE provider = 'comgate' AND provider_subscription_id = ?`,
          )
          .bind(subscriptionId)
          .run();
        if (existing?.user_id) {
          try {
            await removeSubscriberFromNewsletter(db, existing.user_id, env);
          } catch (brevoErr) {
            console.error('[comgate webhook] newsletter remove failed', {
              userId: existing.user_id,
              err: brevoErr,
            });
          }
          try {
            await revokeOfflineLicensesForUser(db, existing.user_id, 'subscription_past_due');
          } catch (offlineErr) {
            console.error('[comgate webhook] offline revoke failed', {
              userId: existing.user_id,
              err: offlineErr,
            });
            throw offlineErr;
          }
        }
      }
    }

    return new Response('code=0&message=OK', {
      status: 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...corsHeaders },
    });
  } catch (err) {
    console.error('handleComgateWebhook error:', err);
    return new Response('code=0&message=OK', {
      status: 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...corsHeaders },
    });
  }
}

/**
 * GET /api/account/subscription — protected
 * Returns the most recent subscription row for the authenticated user.
 */
export async function handleGetSubscription(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  try {
    const db = getDb(env);
    if (isAdministrativeRole(user.role)) {
      const now = new Date().toISOString();
      return jsonResponse(
        {
          subscription: {
            id: `role:${user.role}`,
            planType: 'staff',
            status: 'active',
            provider: 'staff',
            providerCustomerId: null,
            stripeCustomerId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            createdAt: now,
            updatedAt: now,
          },
        },
        200,
        corsHeaders,
      );
    }

    const sub = await db
      .prepare(`
      SELECT id, user_id, plan_type, status, provider, provider_customer_id, stripe_customer_id,
             current_period_end, cancel_at_period_end, created_at, updated_at
      FROM subscriptions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
      .bind(user.sub)
      .first();

    if (!sub) {
      return jsonResponse({ subscription: null }, 200, corsHeaders);
    }

    const provider = sub.provider ?? 'stripe';
    let legacyManageUrl: string | null = null;
    let showLegacyManageButton = false;
    let legacyProviderName: string | null = null;
    if (provider === 'legacy') {
      const [urlRaw, showRaw, nameRaw] = await Promise.all([
        getSetting(env, 'legacy_manage_subscription_url', { ttlSeconds: 300 }),
        getSetting(env, 'legacy_show_manage_button', { ttlSeconds: 300 }),
        getSetting(env, 'legacy_provider_name', { ttlSeconds: 300 }),
      ]);
      const url = String(urlRaw ?? '').trim();
      legacyManageUrl = url || null;
      showLegacyManageButton = String(showRaw ?? '0') === '1' && Boolean(url);
      const name = String(nameRaw ?? '').trim();
      legacyProviderName = name || null;
    }

    return jsonResponse(
      {
        subscription: {
          id: sub.id,
          planType: sub.plan_type,
          status: sub.status,
          provider,
          providerCustomerId: sub.provider_customer_id ?? null,
          stripeCustomerId: sub.stripe_customer_id,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd:
            sub.cancel_at_period_end === 1 ||
            sub.cancel_at_period_end === true ||
            sub.cancel_at_period_end === '1',
          createdAt: sub.created_at,
          updatedAt: sub.updated_at,
          legacyManageUrl,
          showLegacyManageButton,
          legacyProviderName,
        },
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error('handleGetSubscription error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

/**
 * POST /api/payments/portal — protected
 * Creates a Stripe Customer Portal session so users can manage their subscription.
 * Returns { portalUrl }.
 */
export async function handlePortal(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  try {
    const db = getDb(env);
    const sub = await db
      .prepare(`
      SELECT provider, provider_customer_id, stripe_customer_id, provider_subscription_id
      FROM subscriptions
      WHERE user_id = ?
      ORDER BY
        CASE
          WHEN status IN ('active', 'trialing', 'past_due') THEN 0
          ELSE 1
        END,
        created_at DESC
      LIMIT 1
    `)
      .bind(user.sub)
      .first();

    if (!sub) {
      return jsonResponse({ error: 'No active subscription found' }, 404, corsHeaders);
    }

    const dbProvider = String(sub.provider ?? 'stripe');
    const registryId = dbProviderToRegistryId(dbProvider);
    const { providers } = await getPaymentProviders(env);
    const provider = providers.get(registryId);
    const customerId = String(sub.provider_customer_id ?? sub.stripe_customer_id ?? '').trim();
    const subscriptionId = String(sub.provider_subscription_id ?? '').trim();
    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3000';

    // Stripe Billing Portal requires a customer id; missing id means the row is incomplete.
    if (registryId === 'stripe' && !customerId) {
      return jsonResponse({ error: 'No active subscription found' }, 404, corsHeaders);
    }

    if (provider?.getManageUrl) {
      const portalUrl = await provider.getManageUrl({
        customerId: customerId || null,
        subscriptionId: subscriptionId || null,
        returnUrl: `${frontendUrl}/account`,
      });
      if (portalUrl) {
        return jsonResponse({ portalUrl }, 200, corsHeaders);
      }
    }

    const providerName =
      dbProvider === 'legacy'
        ? String(
            (await getSetting(env, 'legacy_provider_name', { defaultValue: 'Qerko' })) ?? 'Qerko',
          ).trim() || 'Qerko'
        : registryId;
    return jsonResponse(
      {
        error: `Manage your subscription in the ${providerName} app or website.`,
        code: 'portal_not_supported',
        providerName,
      },
      409,
      corsHeaders,
    );
  } catch (err) {
    console.error('handlePortal error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
