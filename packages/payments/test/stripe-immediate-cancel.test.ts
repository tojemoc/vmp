/**
 * Stripe immediate cancellation for account deletion.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createStripeProvider } from '../src/providers/stripe/index.js';

describe('Stripe cancelSubscriptionImmediately', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('DELETEs the subscription and advertises immediateCancellation', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ id: 'sub_123', status: 'canceled' }), { status: 200 });
    }) as typeof fetch;

    const provider = createStripeProvider({
      secretKey: 'sk_test',
      frontendUrl: 'http://localhost:3000',
      priceIdForPlan: async () => 'price_1',
    });
    assert.equal(provider.capabilities.immediateCancellation, true);
    await provider.cancelSubscriptionImmediately('sub_123');
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/subscriptions\/sub_123$/);
    assert.equal(calls[0]!.method, 'DELETE');
  });

  it('treats resource_missing as success (idempotent)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'resource_missing', message: 'No such' } }), {
        status: 200,
      })) as typeof fetch;

    const provider = createStripeProvider({
      secretKey: 'sk_test',
      frontendUrl: 'http://localhost:3000',
      priceIdForPlan: async () => 'price_1',
    });
    await provider.cancelSubscriptionImmediately('sub_gone');
  });

  it('createCheckoutSession exposes Stripe session.id as orderId', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: 'cs_test_abc',
          client_secret: 'cs_test_abc_secret',
          metadata: { userId: 'u1' },
        }),
        { status: 200 },
      )) as typeof fetch;

    const provider = createStripeProvider({
      secretKey: 'sk_test',
      frontendUrl: 'http://localhost:3000',
      priceIdForPlan: async () => 'price_1',
    });
    const session = await provider.createCheckoutSession({
      userId: 'u1',
      email: 'a@example.com',
      planType: 'monthly',
      returnPath: '/account',
    });
    assert.equal(session.orderId, 'cs_test_abc');
    assert.equal(session.clientSecret, 'cs_test_abc_secret');
  });

  it('createCheckoutSession omits payment_method_types for Dashboard dynamic methods', async () => {
    let postedBody = '';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      postedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          id: 'cs_test_dyn',
          client_secret: 'cs_test_dyn_secret',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createStripeProvider({
      secretKey: 'sk_test',
      frontendUrl: 'http://localhost:3000',
      priceIdForPlan: async () => 'price_1',
    });
    await provider.createCheckoutSession({
      userId: 'u1',
      email: 'a@example.com',
      planType: 'monthly',
      returnPath: '/account',
    });

    // application/x-www-form-urlencoded from stripePost — key must be absent.
    assert.equal(postedBody.includes('payment_method_types'), false);
    assert.match(postedBody, /ui_mode=elements/);
    assert.match(postedBody, /mode=subscription/);
  });

  it('checkout.session.completed sets providerOrderId from session id', async () => {
    const provider = createStripeProvider({
      secretKey: 'sk_test',
      frontendUrl: 'http://localhost:3000',
      priceIdForPlan: async () => 'price_1',
    });
    const event = await provider.handleWebhook(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_xyz',
            subscription: 'sub_1',
            customer: 'cus_1',
            metadata: { userId: 'u1', planType: 'monthly' },
          },
        },
      }),
    );
    assert.equal(event.type, 'checkout.completed');
    assert.equal(event.providerOrderId, 'cs_test_xyz');
    assert.equal(event.subscriptionId, 'sub_1');
  });
});
