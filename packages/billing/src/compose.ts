/**
 * Billing Worker composition — no Nuxt / @vmp/api imports.
 * Qerko (legacy eshop) is not composed here; it remains on the API Worker until
 * the eshop client is moved. Stripe is the default PSP for new subscriptions.
 */
import {
  createEnabledProviders,
  createPaymentMiddleware,
  getRunnableProviderIds,
  type PaymentMiddleware,
  type PaymentProviderId,
  type PaymentsConfig,
  type PlanType,
} from '@vmp/payments';

export type BillingWorkerEnv = {
  video_subscription_db: D1Database;
  FLAGS?: {
    getBooleanValue(flagKey: string, defaultValue: boolean): Promise<boolean>;
  };
  FLAGSHIP_DEV_OVERRIDE?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FRONTEND_URL?: string;
  GOPAY_CLIENT_ID?: string;
  GOPAY_CLIENT_SECRET?: string;
  GOPAY_GOID?: string;
  GOPAY_API_BASE?: string;
  COMGATE_MERCHANT?: string;
  COMGATE_SECRET?: string;
  COMGATE_API_BASE?: string;
  COMGATE_COUNTRY?: string;
  API_URL?: string;
};

async function stubPriceId(_plan: PlanType): Promise<string | null> {
  return null;
}

async function stubAmount(_plan: PlanType): Promise<number | null> {
  return null;
}

function buildConfig(env: BillingWorkerEnv): PaymentsConfig {
  return {
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      frontendUrl: env.FRONTEND_URL,
      priceIdForPlan: stubPriceId,
    },
    gopay: {
      clientId: env.GOPAY_CLIENT_ID,
      clientSecret: env.GOPAY_CLIENT_SECRET,
      goId: env.GOPAY_GOID,
      apiBase: env.GOPAY_API_BASE,
      frontendUrl: env.FRONTEND_URL,
      notificationUrl: env.API_URL
        ? `${String(env.API_URL).replace(/\/$/, '')}/api/payments/webhook/gopay`
        : undefined,
      amountMajorForPlan: stubAmount,
      currency: async () => 'EUR',
    },
    comgate: {
      merchant: env.COMGATE_MERCHANT,
      secret: env.COMGATE_SECRET,
      apiBase: env.COMGATE_API_BASE,
      frontendUrl: env.FRONTEND_URL,
      country: env.COMGATE_COUNTRY,
      amountMajorForPlan: stubAmount,
      currency: async () => 'EUR',
    },
  };
}

export function createBillingMiddleware(env: BillingWorkerEnv): PaymentMiddleware {
  const enabled: PaymentProviderId[] = ['stripe', 'gopay', 'comgate'];
  const providers = createEnabledProviders(enabled, buildConfig(env));
  const runnable = getRunnableProviderIds(providers);

  return createPaymentMiddleware({
    db: env.video_subscription_db,
    providers,
    runnableOrder: runnable.includes('stripe') ? ['stripe', ...runnable.filter((p) => p !== 'stripe')] : runnable,
    allowRedirectPspNewSubs: false,
    flags: {
      async getBoolean(id) {
        if (env.FLAGS) {
          try {
            return await env.FLAGS.getBooleanValue(id, false);
          } catch {
            return false;
          }
        }
        return false;
      },
    },
  });
}
