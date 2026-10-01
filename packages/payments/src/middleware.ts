/**
 * Product payment middleware — Nuxt/API-free, Worker-extractable.
 *
 * Product code should call these methods instead of PSP SDKs directly.
 * Composition roots inject db / providers / flags / PostHog capture.
 */
import { NotImplementedError } from './errors.js';
import type { PaymentProviderId } from './ids.js';
import {
  type PspSource,
  dbProviderToPspSource,
  normalizePspSource,
  pspSourceToDbProvider,
} from './pspSource.js';
import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  PaymentProvider,
  PlanType,
} from './types.js';

export type { PspSource };

export type SubscriptionRecord = {
  id: string;
  userId: string;
  planType: string;
  status: string;
  source: PspSource;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CreateSubscriptionParams = CreateCheckoutSessionInput & {
  /** Preferred PSP; defaults to stripe for new subscribers. */
  source?: PspSource | null;
  /** When true, allows qerko relink even if new qerko creates are gated. */
  isRelink?: boolean;
};

export type SubscriptionResult =
  | { type: 'checkout'; session: CheckoutSession; source: PspSource }
  | { type: 'error'; code: string; message: string; status: number };

export type CancelSubscriptionResult =
  | { type: 'cancelled'; source: PspSource }
  | { type: 'error'; code: string; message: string; status: number };

export type PaymentMiddlewareDb = {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
};

export type PaymentMiddlewareFlags = {
  getBoolean(id: string): Promise<boolean>;
};

export type PaymentMiddlewareCapture = (input: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}) => Promise<void> | void;

export type PaymentMiddlewareDeps = {
  db: PaymentMiddlewareDb;
  providers: Map<PaymentProviderId, PaymentProvider>;
  /** Ordered runnable provider ids for checkout selection. */
  runnableOrder: PaymentProviderId[];
  flags: PaymentMiddlewareFlags;
  capturePostHog?: PaymentMiddlewareCapture;
  /**
   * Soft-disable: when false (default), gopay/comgate cannot be selected for new subs.
   * Existing rows can still be cancelled / webhooked via providers map.
   */
  allowRedirectPspNewSubs?: boolean;
};

export interface PaymentMiddleware {
  hasSubscription(userId: string): Promise<{ active: boolean; source: PspSource | null }>;
  getSubscription(userId: string): Promise<SubscriptionRecord | null>;
  createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult>;
  cancelSubscription(userId: string, source: PspSource): Promise<CancelSubscriptionResult>;
  /** Stub / future: always stripe for new subs until MoR policy exists. */
  selectPspForNewSubscription(input: {
    billingCountry?: string | null;
    existingSource?: PspSource | null;
  }): PspSource;
}

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

function rowToRecord(row: Record<string, unknown>): SubscriptionRecord {
  const dbProvider = String(row.provider ?? 'stripe');
  return {
    id: String(row.id),
    userId: String(row.user_id),
    planType: String(row.plan_type ?? ''),
    status: String(row.status ?? ''),
    source: dbProviderToPspSource(dbProvider),
    providerSubscriptionId:
      row.provider_subscription_id != null ? String(row.provider_subscription_id) : null,
    providerCustomerId:
      row.provider_customer_id != null
        ? String(row.provider_customer_id)
        : row.stripe_customer_id != null
          ? String(row.stripe_customer_id)
          : null,
    currentPeriodEnd: row.current_period_end != null ? String(row.current_period_end) : null,
    cancelAtPeriodEnd:
      row.cancel_at_period_end === 1 ||
      row.cancel_at_period_end === true ||
      row.cancel_at_period_end === '1',
    createdAt: row.created_at != null ? String(row.created_at) : null,
    updatedAt: row.updated_at != null ? String(row.updated_at) : null,
  };
}

function isPeriodActive(currentPeriodEnd: string | null): boolean {
  if (!currentPeriodEnd) return true;
  const end = Date.parse(currentPeriodEnd);
  if (Number.isNaN(end)) return true;
  return end > Date.now();
}

export function createPaymentMiddleware(deps: PaymentMiddlewareDeps): PaymentMiddleware {
  const allowRedirect = deps.allowRedirectPspNewSubs === true;

  async function emit(
    distinctId: string,
    event: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    if (!deps.capturePostHog) return;
    try {
      await deps.capturePostHog({ distinctId, event, properties });
    } catch {
      // never fail billing on analytics
    }
  }

  function selectPspForNewSubscription(input: {
    billingCountry?: string | null;
    existingSource?: PspSource | null;
  }): PspSource {
    if (input.existingSource === 'qerko') return 'qerko';
    return 'stripe';
  }

  async function hasSubscription(userId: string) {
    const row = await deps.db
      .prepare(
        `
          SELECT provider, status, current_period_end
          FROM subscriptions
          WHERE user_id = ?
            AND status IN ('active', 'trialing')
            AND (current_period_end IS NULL OR datetime(current_period_end) > CURRENT_TIMESTAMP)
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .bind(userId)
      .first();
    if (!row) return { active: false, source: null as PspSource | null };
    return { active: true, source: dbProviderToPspSource(String(row.provider ?? 'stripe')) };
  }

  /** Billing-existence guard: blocks create when an open billable sub already exists. */
  async function hasBlockingSubscription(userId: string): Promise<boolean> {
    const row = await deps.db
      .prepare(
        `
          SELECT id
          FROM subscriptions
          WHERE user_id = ?
            AND status IN ('active', 'trialing', 'past_due')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .bind(userId)
      .first();
    return Boolean(row);
  }

  async function getSubscription(userId: string) {
    const row = await deps.db
      .prepare(
        `
          SELECT id, user_id, plan_type, status, provider, provider_subscription_id,
                 provider_customer_id, stripe_customer_id, current_period_end,
                 cancel_at_period_end, created_at, updated_at
          FROM subscriptions
          WHERE user_id = ?
          ORDER BY
            CASE status
              WHEN 'active' THEN 0
              WHEN 'trialing' THEN 1
              WHEN 'past_due' THEN 2
              ELSE 3
            END ASC,
            created_at DESC
          LIMIT 1
        `,
      )
      .bind(userId)
      .first();
    if (!row) return null;
    const record = rowToRecord(row);
    await emit(userId, 'subscription_checked', {
      psp_source: record.source,
      status: record.status,
      active: ACTIVE_STATUSES.has(record.status) && isPeriodActive(record.currentPeriodEnd),
    });
    return record;
  }

  async function createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult> {
    let requested =
      params.source ??
      selectPspForNewSubscription({
        existingSource: params.isRelink ? 'qerko' : null,
      });

    if (requested === 'mor') {
      throw new NotImplementedError('Merchant of Record (mor) is not implemented');
    }

    if ((requested === 'gopay' || requested === 'comgate') && !allowRedirect) {
      return {
        type: 'error',
        code: 'provider_soft_disabled',
        message: `${requested} is not enabled for new subscriptions`,
        status: 503,
      };
    }

    if (requested === 'qerko') {
      const legacyOn = await deps.flags.getBoolean('legacy_migration');
      if (!legacyOn && !params.isRelink) {
        return {
          type: 'error',
          code: 'feature_disabled',
          message: 'Qerko checkout is disabled (legacy_migration flag off)',
          status: 404,
        };
      }
    }

    const providerId = requested as PaymentProviderId;
    if (!deps.runnableOrder.includes(providerId)) {
      const fallback =
        deps.runnableOrder.find((id) => {
          if (id === 'gopay' || id === 'comgate') return allowRedirect;
          return id === 'stripe' || (id === 'qerko' && params.isRelink);
        }) ?? null;
      if (!fallback) {
        return {
          type: 'error',
          code: 'provider_not_configured',
          message: 'No payment provider is available',
          status: 503,
        };
      }
      requested = fallback;
    }

    const provider = deps.providers.get(requested as PaymentProviderId);
    if (!provider?.isConfigured()) {
      return {
        type: 'error',
        code: 'provider_not_configured',
        message: 'Requested payment provider is not configured',
        status: 503,
      };
    }

    if (!provider.capabilities.newSubscriptions && !params.isRelink) {
      return {
        type: 'error',
        code: 'provider_not_supported',
        message: 'Provider does not allow new subscriptions',
        status: 400,
      };
    }

    if (!params.isRelink && (await hasBlockingSubscription(params.userId))) {
      return {
        type: 'error',
        code: 'subscription_exists',
        message: 'An active subscription already exists',
        status: 409,
      };
    }

    const session = await provider.createCheckoutSession(params);
    await emit(params.userId, 'subscription_checkout_started', {
      psp_source: requested,
      plan_type: params.planType,
      source: 'payment_middleware',
    });

    return { type: 'checkout', session, source: requested };
  }

  async function cancelSubscription(
    userId: string,
    source: PspSource,
  ): Promise<CancelSubscriptionResult> {
    if (source === 'mor') {
      throw new NotImplementedError('Merchant of Record (mor) is not implemented');
    }

    const dbProvider = pspSourceToDbProvider(source);
    const row = await deps.db
      .prepare(
        `
          SELECT id, provider_subscription_id, cancel_at_period_end, status
          FROM subscriptions
          WHERE user_id = ? AND provider = ?
            AND status IN ('active', 'trialing', 'past_due')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .bind(userId, dbProvider)
      .first();

    if (!row) {
      return {
        type: 'error',
        code: 'subscription_not_found',
        message: 'No cancellable subscription found',
        status: 404,
      };
    }

    if (source === 'stripe' || source === 'qerko') {
      return {
        type: 'error',
        code: 'cancel_use_portal',
        message: 'Use the billing portal to cancel this subscription',
        status: 409,
      };
    }

    const already =
      row.cancel_at_period_end === 1 ||
      row.cancel_at_period_end === true ||
      row.cancel_at_period_end === '1';
    if (already) {
      return { type: 'cancelled', source };
    }

    const provider = deps.providers.get(source);
    const subId = row.provider_subscription_id != null ? String(row.provider_subscription_id) : '';
    if (!provider || !subId) {
      return {
        type: 'error',
        code: 'provider_not_configured',
        message: 'Cannot cancel: provider or subscription id missing',
        status: 503,
      };
    }

    await provider.cancelSubscription(subId);
    await deps.db
      .prepare(
        `
          UPDATE subscriptions
          SET cancel_at_period_end = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .bind(String(row.id))
      .run();

    await emit(userId, 'subscription_cancelled', {
      psp_source: source,
      source: 'payment_middleware',
    });

    return { type: 'cancelled', source };
  }

  return {
    selectPspForNewSubscription,
    hasSubscription,
    getSubscription,
    createSubscription,
    cancelSubscription,
  };
}

/** Resolve client-supplied provider string to PspSource. */
export function resolveRequestedPspSource(raw: unknown): PspSource | null {
  if (raw == null || raw === '') return null;
  return normalizePspSource(String(raw));
}

export type { PlanType };
