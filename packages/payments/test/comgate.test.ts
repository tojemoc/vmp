import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createComgateProvider } from '../src/providers/comgate/index.js';
import type { ComgatePaymentsConfig, PlanType } from '../src/types.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchSequence(
  responses: Array<{ status?: number; body: string }>,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses[i++] ?? { status: 500, body: 'code=1500&message=unexpected' };
    return new Response(next.body, {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }) as typeof fetch;
  return calls;
}

function baseConfig(overrides: Partial<ComgatePaymentsConfig> = {}): ComgatePaymentsConfig {
  return {
    merchant: '123456',
    secret: 'test-secret',
    apiBase: 'https://payments.comgate.cz',
    frontendUrl: 'https://app.example',
    country: 'CZ',
    lang: 'cs',
    amountMajorForPlan: async (plan: PlanType) => (plan === 'yearly' ? 999 : 199),
    currency: async () => 'CZK',
    ...overrides,
  };
}

describe('createComgateProvider', () => {
  it('isConfigured requires merchant + secret + frontendUrl', () => {
    assert.equal(createComgateProvider(baseConfig()).isConfigured(), true);
    assert.equal(createComgateProvider(baseConfig({ secret: undefined })).isConfigured(), false);
  });

  it('createCheckoutSession returns redirect URL + transId', async () => {
    const calls = mockFetchSequence([
      {
        body: 'code=0&message=OK&transId=AB12-CD34-EF56&redirect=https%3A%2F%2Fpayments.comgate.cz%2Fclient%2Finstructions%2F%3Fid%3DABC',
      },
    ]);
    const provider = createComgateProvider(baseConfig());
    const session = await provider.createCheckoutSession({
      userId: 'user-1',
      email: 'a@example.com',
      planType: 'monthly',
      returnPath: '/account',
    });
    assert.equal(session.provider, 'comgate');
    assert.equal(session.checkoutUrl, 'https://payments.comgate.cz/client/instructions/?id=ABC');
    assert.equal(session.orderId, 'AB12-CD34-EF56');
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/v1\.0\/create$/);
    const bodyStr = String(calls[0]!.init?.body ?? '');
    assert.ok(bodyStr.includes('initRecurring=true'));
    assert.ok(bodyStr.includes('prepareOnly=true'));
    assert.ok(bodyStr.includes('price=19900'));
  });

  it('verifyWebhookSignature checks secret match', async () => {
    const provider = createComgateProvider(baseConfig());
    assert.equal(await provider.verifyWebhookSignature('secret=test-secret&transId=X', ''), true);
    assert.equal(await provider.verifyWebhookSignature('secret=wrong&transId=X', ''), false);
  });

  it('handleWebhook re-fetches status and normalizes PAID', async () => {
    mockFetchSequence([
      {
        body: 'code=0&message=OK&merchant=123456&transId=AB12-CD34-EF56&status=PAID&refId=order-42&price=19900&curr=CZK&label=VMP%20monthly&email=a%40example.com',
      },
    ]);
    const provider = createComgateProvider(baseConfig());
    const event = await provider.handleWebhook(
      'merchant=123456&secret=test-secret&transId=AB12-CD34-EF56&status=PAID',
    );
    assert.equal(event.type, 'checkout.completed');
    assert.equal(event.providerId, 'comgate');
    assert.equal(event.subscriptionId, 'AB12-CD34-EF56');
    assert.equal(event.purchaseId, 'order-42');
  });

  it('cancelSubscription calls /v1.0/cancel', async () => {
    const calls = mockFetchSequence([{ body: 'code=0&message=OK' }]);
    const provider = createComgateProvider(baseConfig());
    await provider.cancelSubscription('AB12-CD34-EF56');
    assert.match(calls[0]!.url, /\/v1\.0\/cancel$/);
  });

  it('refund calls /v1.0/refund with amount', async () => {
    const calls = mockFetchSequence([{ body: 'code=0&message=OK' }]);
    const provider = createComgateProvider(baseConfig());
    await provider.refund('AB12-CD34-EF56', { amountMinor: 5000 });
    assert.match(calls[0]!.url, /\/v1\.0\/refund$/);
    const bodyStr = String(calls[0]!.init?.body ?? '');
    assert.ok(bodyStr.includes('amount=5000'));
  });
});
