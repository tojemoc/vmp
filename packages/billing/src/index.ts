/**
 * vmp-billing — extractable PaymentMiddleware Worker (Phase F).
 *
 * Exposes WorkerEntrypoint methods mirroring PaymentMiddleware for service-binding RPC
 * from @vmp/api. HTTP fetch is a health/ready probe; webhooks may be re-pointed here later.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type {
  CancelSubscriptionResult,
  CreateSubscriptionParams,
  PspSource,
  SubscriptionRecord,
  SubscriptionResult,
} from '@vmp/payments';
import { createBillingMiddleware, type BillingWorkerEnv } from './compose.js';

export class BillingService extends WorkerEntrypoint<BillingWorkerEnv> {
  private middleware() {
    return createBillingMiddleware(this.env);
  }

  async hasSubscription(userId: string): Promise<{ active: boolean; source: PspSource | null }> {
    return this.middleware().hasSubscription(userId);
  }

  async getSubscription(userId: string): Promise<SubscriptionRecord | null> {
    return this.middleware().getSubscription(userId);
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult> {
    return this.middleware().createSubscription(params);
  }

  async cancelSubscription(
    userId: string,
    source: PspSource,
  ): Promise<CancelSubscriptionResult> {
    return this.middleware().cancelSubscription(userId, source);
  }

  selectPspForNewSubscription(input: {
    billingCountry?: string | null;
    existingSource?: PspSource | null;
  }): PspSource {
    return this.middleware().selectPspForNewSubscription(input);
  }
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({
      service: 'vmp-billing',
      ok: true,
      note: 'Use BillingService service binding for PaymentMiddleware RPC',
    });
  },
};
