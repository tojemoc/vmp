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
  /** Phase F service binding (WorkerEntrypoint). */
  BILLING?: PaymentMiddleware;
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
 * Prefer extracted billing Worker when bound; otherwise build middleware in-process.
 * Falls back to in-process if the service binding is missing or RPC fails to construct.
 */
export async function getBillingMiddleware(env: BillingEnv): Promise<PaymentMiddleware> {
  const remote = env.BILLING;
  if (remote && typeof remote.hasSubscription === 'function') {
    return remote;
  }
  return createLocalBillingMiddleware(env);
}
