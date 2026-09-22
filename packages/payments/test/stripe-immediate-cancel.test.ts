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
});
