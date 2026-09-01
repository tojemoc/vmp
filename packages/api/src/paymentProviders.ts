/**
 * Payment provider composition root — wires @vmp/payments registry to Worker env + legacy modules.
 */

import {
  createEnabledProviders,
  getRunnableProviderIds,
  normalizeProviderId,
  parseQerkoWebhookPayload,
  type PaymentProviderId,
  type PaymentsConfig,
  type PlanType,
  parseProviderIdList,
  providerIdToDbProvider,
} from '@vmp/payments';
import { startLegacyCheckout } from './legacyPayments.js';
import { isLegacyCheckoutConfigured, verifyLegacyWebhookSignature } from './legacyProvider.js';
import { getSetting } from './settingsStore.js';

/** All registry IDs (including stubs) that may appear in admin settings. */
const KNOWN_PROVIDER_IDS: PaymentProviderId[] = ['stripe', 'qerko', 'gopay', 'comgate'];
const DEFAULT_ENABLED: PaymentProviderId[] = ['stripe'];

/** Public API provider ids exposed to checkout / pricing. */
export type ApiPaymentProviderId = 'stripe' | 'legacy' | 'gopay' | 'comgate';

async function priceIdForPlan(env: any, planType: PlanType): Promise<string | null> {
  const stored = await getSetting(env, `stripe_price_${planType}`, { ttlSeconds: 300 });
  const value = String(stored ?? '').trim();
  return value || null;
}

async function gopayAmountMajorForPlan(env: any, planType: PlanType): Promise<number | null> {
  const stored = await getSetting(env, `gopay_${planType}_price`, { ttlSeconds: 300 });
  const value = String(stored ?? '').trim();
  if (value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const fallback = await getSetting(env, `${planType}_price_eur`, { ttlSeconds: 300 });
  const fallbackValue = String(fallback ?? '').trim();
  if (!fallbackValue) return null;
  const fallbackNumeric = Number(fallbackValue);
  return Number.isFinite(fallbackNumeric) && fallbackNumeric > 0 ? fallbackNumeric : null;
}

async function comgateAmountMajorForPlan(env: any, planType: PlanType): Promise<number | null> {
  const stored = await getSetting(env, `comgate_${planType}_price`, { ttlSeconds: 300 });
  const value = String(stored ?? '').trim();
  if (value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const fallback = await getSetting(env, `${planType}_price_eur`, { ttlSeconds: 300 });
  const fallbackValue = String(fallback ?? '').trim();
  if (!fallbackValue) return null;
  const fallbackNumeric = Number(fallbackValue);
  return Number.isFinite(fallbackNumeric) && fallbackNumeric > 0 ? fallbackNumeric : null;
}

function requireConfiguredUrl(raw: unknown, label: string): string {
  const value = String(raw ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!value) throw new Error(`${label} is not configured`);
  return value;
}

export function getGoPayNotificationUrl(env: any): string {
  const apiBase = requireConfiguredUrl(env.API_URL, 'API_URL');
  return `${apiBase}/api/payments/webhook/gopay`;
}

export function isGoPayConfigured(env: any): boolean {
  return Boolean(
    String(env.GOPAY_CLIENT_ID ?? '').trim() &&
      String(env.GOPAY_CLIENT_SECRET ?? '').trim() &&
      String(env.GOPAY_GOID ?? '').trim() &&
      String(env.API_URL ?? '').trim(),
  );
}

export function isComgateConfigured(env: any): boolean {
  return Boolean(
    String(env.COMGATE_MERCHANT ?? '').trim() && String(env.COMGATE_SECRET ?? '').trim(),
  );
}

export function buildPaymentsConfig(env: any): PaymentsConfig {
  return {
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      frontendUrl: env.FRONTEND_URL,
      priceIdForPlan: (planType) => priceIdForPlan(env, planType),
    },
    qerko: {
      isConfigured: () => isLegacyCheckoutConfigured(env),
      createCheckout: async (input) => {
        const corsHeaders: Record<string, string> = {};
        const response = await startLegacyCheckout(
          env,
          { sub: input.userId, email: input.email },
          {
            planType: input.planType,
            returnPath: input.returnPath,
            purchaseId: input.purchaseId,
          },
          corsHeaders,
        );
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          const err = new Error(String(payload.error ?? 'Legacy checkout failed'));
          Object.assign(err, { code: payload.code, status: response.status });
          throw err;
        }
        return {
          provider: 'qerko' as const,
          ...(typeof payload.checkoutUrl === 'string' ? { checkoutUrl: payload.checkoutUrl } : {}),
          ...(typeof payload.orderId === 'string' ? { orderId: payload.orderId } : {}),
        };
      },
      verifyWebhook: (rawBody, signatureHeader) =>
        verifyLegacyWebhookSignature(env, rawBody, signatureHeader),
      parseWebhook: async (rawBody) =>
        parseQerkoWebhookPayload(rawBody ? JSON.parse(rawBody) : {}),
      cancelSubscription: async () => {
        throw new Error('Qerko subscription cancellation is managed in the legacy eshop portal');
      },
      getCustomer: async (customerId) => ({ id: customerId }),
      refund: async () => {
        throw new Error('Qerko refunds are not implemented in VMP');
      },
      createSubscription: async () => {
        throw new Error('Direct Qerko subscription creation is not supported');
      },
      getManageUrl: async () => {
        const [urlRaw, showRaw] = await Promise.all([
          getSetting(env, 'legacy_manage_subscription_url', { defaultValue: '' }),
          getSetting(env, 'legacy_show_manage_button', { defaultValue: '0' }),
        ]);
        if (String(showRaw ?? '0') !== '1') return null;
        const url = String(urlRaw ?? '').trim();
        return url || null;
      },
    },
    gopay: {
      ...(String(env.GOPAY_CLIENT_ID ?? '').trim()
        ? { clientId: String(env.GOPAY_CLIENT_ID).trim() }
        : {}),
      ...(String(env.GOPAY_CLIENT_SECRET ?? '').trim()
        ? { clientSecret: String(env.GOPAY_CLIENT_SECRET).trim() }
        : {}),
      ...(String(env.GOPAY_GOID ?? '').trim() ? { goId: String(env.GOPAY_GOID).trim() } : {}),
      apiBase: String(env.GOPAY_API_BASE ?? '').trim() || 'https://gw.sandbox.gopay.com/api',
      frontendUrl: env.FRONTEND_URL,
      ...(String(env.API_URL ?? '').trim()
        ? { notificationUrl: getGoPayNotificationUrl(env) }
        : {}),
      amountMajorForPlan: (planType) => gopayAmountMajorForPlan(env, planType),
      currency: async () => {
        const stored = await getSetting(env, 'gopay_currency', {
          defaultValue: 'CZK',
          ttlSeconds: 300,
        });
        return (
          String(stored ?? 'CZK')
            .trim()
            .toUpperCase() || 'CZK'
        );
      },
    },
    comgate: {
      ...(String(env.COMGATE_MERCHANT ?? '').trim()
        ? { merchant: String(env.COMGATE_MERCHANT).trim() }
        : {}),
      ...(String(env.COMGATE_SECRET ?? '').trim()
        ? { secret: String(env.COMGATE_SECRET).trim() }
        : {}),
      apiBase: String(env.COMGATE_API_BASE ?? '').trim() || 'https://payments.comgate.cz',
      frontendUrl: env.FRONTEND_URL,
      country: String(env.COMGATE_COUNTRY ?? 'CZ').trim() || 'CZ',
      lang: 'cs',
      amountMajorForPlan: (planType) => comgateAmountMajorForPlan(env, planType),
      currency: async () => {
        const stored = await getSetting(env, 'comgate_currency', {
          defaultValue: 'CZK',
          ttlSeconds: 300,
        });
        return (
          String(stored ?? 'CZK')
            .trim()
            .toUpperCase() || 'CZK'
        );
      },
    },
  };
}

/**
 * Providers listed in admin settings. Empty / missing → default Stripe.
 */
export async function getConfiguredProviderIds(env: any): Promise<PaymentProviderId[]> {
  const stored = await getSetting(env, 'payments_enabled_providers', { defaultValue: 'stripe' });
  const raw = String(stored ?? '').trim();
  if (!raw) return [...DEFAULT_ENABLED];
  return parseProviderIdList(raw, KNOWN_PROVIDER_IDS);
}

export async function getPaymentProviderOrder(env: any): Promise<PaymentProviderId[]> {
  const stored = await getSetting(env, 'payment_provider_order', { defaultValue: 'stripe,legacy' });
  const raw = String(stored ?? '').trim();
  if (!raw) return [...DEFAULT_ENABLED];
  const parsed = parseProviderIdList(raw, KNOWN_PROVIDER_IDS);
  return parsed.length > 0 ? parsed : [...DEFAULT_ENABLED];
}

export async function getPaymentProviders(env: any) {
  const enabled = await getConfiguredProviderIds(env);
  const config = buildPaymentsConfig(env);
  const providers = createEnabledProviders(enabled, config);
  const runnable = getRunnableProviderIds(providers);
  return { providers, enabled, runnable };
}

export function toApiProviderId(id: PaymentProviderId): ApiPaymentProviderId | null {
  if (id === 'qerko') return 'legacy';
  if (id === 'stripe') return 'stripe';
  if (id === 'gopay') return 'gopay';
  if (id === 'comgate') return 'comgate';
  return null;
}

/** Map registry IDs to public API provider ids, dropping stubs. */
export function toSupportedApiProviderIds(
  ids: readonly PaymentProviderId[],
): ApiPaymentProviderId[] {
  return ids
    .map(toApiProviderId)
    .filter(
      (id): id is ApiPaymentProviderId =>
        id === 'stripe' || id === 'legacy' || id === 'gopay' || id === 'comgate',
    );
}

/**
 * Public checkout/pricing providers = configured ∩ runnable, after stub filtering.
 * Never invents Stripe when only unsupported providers remain.
 */
export function resolvePublicEnabledProviders(
  configuredIds: readonly PaymentProviderId[],
  runnableIds: readonly PaymentProviderId[],
): ApiPaymentProviderId[] {
  const runnableApi = new Set(toSupportedApiProviderIds(runnableIds));
  return toSupportedApiProviderIds(configuredIds).filter((id) => runnableApi.has(id));
}

export function fromApiProviderId(raw: string): PaymentProviderId | null {
  return normalizeProviderId(raw);
}

/** Map D1 `subscriptions.provider` values to registry provider IDs. */
export function dbProviderToRegistryId(dbProvider: string): PaymentProviderId {
  return normalizeProviderId(dbProvider) ?? 'stripe';
}

export { providerIdToDbProvider };
