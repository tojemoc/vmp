/**
 * Billing Worker composition — real provider registry + PaymentMiddleware.
 * No Nuxt / @vmp/api imports.
 */
import { createPaymentMiddleware, type PaymentMiddleware } from '@vmp/payments';
import type { DeploymentFeatureId } from '@vmp/shared';
import { isInfraFeatureEnabled } from './infraFlags.js';
import { getPaymentProviderOrder, getPaymentProviders } from './paymentProviders.js';
import { capturePostHogEvent } from './posthog.js';

export type BillingWorkerEnv = {
  video_subscription_db: D1Database;
  DB?: D1Database;
  BUCKET?: R2Bucket;
  FLAGS?: {
    getBooleanValue(
      flagKey: string,
      defaultValue: boolean,
      context?: Record<string, unknown>,
    ): Promise<boolean>;
  };
  FLAGSHIP_DEV_OVERRIDE?: string;
  JWT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FRONTEND_URL?: string;
  API_URL?: string;
  R2_BASE_URL?: string;
  GOPAY_CLIENT_ID?: string;
  GOPAY_CLIENT_SECRET?: string;
  GOPAY_GOID?: string;
  GOPAY_API_BASE?: string;
  COMGATE_MERCHANT?: string;
  COMGATE_SECRET?: string;
  COMGATE_API_BASE?: string;
  COMGATE_COUNTRY?: string;
  LEGACY_ESHOP_API_URL?: string;
  LEGACY_ESHOP_SANDBOX_API_URL?: string;
  LEGACY_ESHOP_MERCHANT_ID?: string;
  LEGACY_ESHOP_API_KEY?: string;
  LEGACY_ESHOP_WEBHOOK_SECRET?: string;
  BREVO_API_KEY?: string;
  SENDER_EMAIL?: string;
  SENDER_NAME?: string;
  POSTHOG_PROJECT_TOKEN?: string;
  POSTHOG_HOST?: string;
  PEPPOL_AP_API_KEY?: string;
};

export async function createBillingMiddleware(env: BillingWorkerEnv): Promise<PaymentMiddleware> {
  const { providers, runnable } = await getPaymentProviders(env);
  const providerOrder = await getPaymentProviderOrder(env);
  const orderedRunnable = [
    ...providerOrder.filter((p) => runnable.includes(p)),
    ...runnable.filter((p) => !providerOrder.includes(p)),
  ];

  return createPaymentMiddleware({
    db: env.video_subscription_db || (env.DB as D1Database),
    providers,
    runnableOrder: orderedRunnable,
    allowRedirectPspNewSubs: false,
    flags: {
      getBoolean: (id) => isInfraFeatureEnabled(env, id as DeploymentFeatureId),
    },
    capturePostHog: (input) =>
      capturePostHogEvent(env, {
        distinctId: input.distinctId,
        event: input.event,
        ...(input.properties ? { properties: input.properties } : {}),
      }),
  });
}
