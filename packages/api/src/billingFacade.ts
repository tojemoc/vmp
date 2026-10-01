/**
 * Composition root for PaymentMiddleware — in-process now, service-binding ready (Phase F).
 */
import {
  createPaymentMiddleware,
  type PaymentMiddleware,
  type PaymentProviderId,
} from '@vmp/payments';
import type { DeploymentFeatureId } from '@vmp/shared';
import { isInfraFeatureEnabled } from './infraFlags.js';
import { getPaymentProviderOrder, getPaymentProviders } from './paymentProviders.js';
import { capturePostHogEvent } from './posthog.js';

export type BillingEnv = {
  video_subscription_db: D1Database;
  FLAGS?: {
    getBooleanValue(
      flagKey: string,
      defaultValue: boolean,
      context?: Record<string, unknown>,
    ): Promise<boolean>;
  };
  FLAGSHIP_DEV_OVERRIDE?: string;
  /** Phase F service binding (WorkerEntrypoint). Present when wrangler `services` is configured. */
  BILLING?: PaymentMiddleware;
  /**
   * Opt-in RPC to `@vmp/billing`. Default off — billing Worker still uses stub price
   * resolvers / incomplete Qerko wiring; in-process middleware on the API is the live path.
   * Set `BILLING_USE_SERVICE_BINDING=1` only after billing secrets + price lookups are ready.
   */
  BILLING_USE_SERVICE_BINDING?: string;
  POSTHOG_PROJECT_TOKEN?: string;
  POSTHOG_HOST?: string;
};

function getDb(env: BillingEnv) {
  return env.video_subscription_db;
}

function createLocalBillingMiddleware(env: BillingEnv): Promise<PaymentMiddleware> {
  return (async () => {
    const db = getDb(env);
    const { providers, runnable } = await getPaymentProviders(env);
    const providerOrder = await getPaymentProviderOrder(env);
    const orderedRunnable: PaymentProviderId[] = [
      ...providerOrder.filter((p) => runnable.includes(p)),
      ...runnable.filter((p) => !providerOrder.includes(p)),
    ];

    return createPaymentMiddleware({
      db,
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
  })();
}

/**
 * Prefer in-process middleware. Opt into BILLING service-binding RPC only when
 * `BILLING_USE_SERVICE_BINDING=1` and the binding is present.
 */
export async function getBillingMiddleware(env: BillingEnv): Promise<PaymentMiddleware> {
  const useRemote =
    String(env.BILLING_USE_SERVICE_BINDING ?? '').trim() === '1' ||
    String(env.BILLING_USE_SERVICE_BINDING ?? '')
      .trim()
      .toLowerCase() === 'true';
  const remote = env.BILLING;
  if (useRemote && remote && typeof remote.hasSubscription === 'function') {
    return remote;
  }
  return createLocalBillingMiddleware(env);
}
