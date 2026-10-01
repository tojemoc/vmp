import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPaymentMiddleware } from '../src/middleware.js';
import type { PaymentProvider } from '../src/types.js';

function mockDb(rows: Record<string, unknown>[] = []) {
  return {
    prepare(_query: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T = Record<string, unknown>>(): Promise<T | null> {
              return (rows[0] ?? null) as T | null;
            },
            async run() {
              return {};
            },
            async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
              return { results: rows as T[] };
            },
          };
        },
      };
    },
  };
}

function stripeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    id: 'stripe',
    capabilities: {
      newSubscriptions: true,
      migrationOnly: false,
      recurringPayments: true,
      refunds: true,
      webhooks: true,
      immediateCancellation: true,
    },
    isConfigured: () => true,
    async createCheckoutSession() {
      return { provider: 'stripe', clientSecret: 'cs_test' };
    },
    async createSubscription() {
      throw new Error('not used');
    },
    async cancelSubscription() {},
    async cancelSubscriptionImmediately() {},
    async getCustomer() {
      return null;
    },
    async refund() {},
    async verifyWebhookSignature() {
      return true;
    },
    async handleWebhook() {
      return { type: 'unknown', providerId: 'stripe', raw: {} };
    },
    ...overrides,
  };
}

describe('PaymentMiddleware', () => {
  it('hasSubscription maps legacy → qerko', async () => {
    const mw = createPaymentMiddleware({
      db: mockDb([
        {
          provider: 'legacy',
          status: 'active',
          current_period_end: null,
        },
      ]),
      providers: new Map([['stripe', stripeProvider()]]),
      runnableOrder: ['stripe'],
      flags: { getBoolean: async () => true },
    });
    const result = await mw.hasSubscription('user-1');
    assert.equal(result.active, true);
    assert.equal(result.source, 'qerko');
  });

  it('soft-disables gopay for new subscriptions', async () => {
    const mw = createPaymentMiddleware({
      db: mockDb(),
      providers: new Map([['stripe', stripeProvider()]]),
      runnableOrder: ['stripe', 'gopay'],
      allowRedirectPspNewSubs: false,
      flags: { getBoolean: async () => true },
    });
    const result = await mw.createSubscription({
      userId: 'u1',
      email: 'a@b.c',
      planType: 'monthly',
      returnPath: '/account',
      source: 'gopay',
    });
    assert.equal(result.type, 'error');
    if (result.type === 'error') assert.equal(result.code, 'provider_soft_disabled');
  });

  it('blocks qerko create when legacy_migration flag off', async () => {
    const mw = createPaymentMiddleware({
      db: mockDb(),
      providers: new Map([
        ['stripe', stripeProvider()],
        [
          'qerko',
          {
            ...stripeProvider(),
            id: 'qerko',
            async createCheckoutSession() {
              return { provider: 'qerko', checkoutUrl: 'https://example.com' };
            },
          },
        ],
      ]),
      runnableOrder: ['qerko'],
      flags: { getBoolean: async () => false },
    });
    const result = await mw.createSubscription({
      userId: 'u1',
      email: 'a@b.c',
      planType: 'monthly',
      returnPath: '/account',
      source: 'qerko',
    });
    assert.equal(result.type, 'error');
    if (result.type === 'error') assert.equal(result.code, 'feature_disabled');
  });

  it('defaults new subscriptions to stripe', async () => {
    const mw = createPaymentMiddleware({
      db: mockDb(),
      providers: new Map([['stripe', stripeProvider()]]),
      runnableOrder: ['stripe'],
      flags: { getBoolean: async () => true },
    });
    assert.equal(mw.selectPspForNewSubscription({}), 'stripe');
    const result = await mw.createSubscription({
      userId: 'u1',
      email: 'a@b.c',
      planType: 'monthly',
      returnPath: '/account',
    });
    assert.equal(result.type, 'checkout');
    if (result.type === 'checkout') {
      assert.equal(result.source, 'stripe');
      assert.equal(result.session.clientSecret, 'cs_test');
    }
  });
});
