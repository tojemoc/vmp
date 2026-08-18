import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  createGoPayProvider,
  recurrenceForPlan,
  toMinorUnits,
} from '../src/providers/gopay/index.js';
import type { GoPayPaymentsConfig, PlanType } from '../src/types.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchSequence(
  responses: Array<{ status?: number; body: unknown }>,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses[i++] ?? { status: 500, body: { error: 'unexpected fetch' } };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function baseConfig(overrides: Partial<GoPayPaymentsConfig> = {}): GoPayPaymentsConfig {
  return {
    clientId: 'client',
    clientSecret: 'secret',
    goId: '1234567890',
    apiBase: 'https://gw.sandbox.gopay.com/api',
    frontendUrl: 'https://app.example',
    notificationUrl: 'https://api.example/api/payments/webhook/gopay',
    amountMajorForPlan: async (plan: PlanType) => (plan === 'yearly' ? 999 : 199),
    currency: async () => 'CZK',
    ...overrides,
  };
}

describe('GoPay helpers', () => {
  it('converts major units to minor units', () => {
    assert.equal(toMinorUnits(199), 19900);
    assert.equal(toMinorUnits(12.5), 1250);
  });

  it('maps plan types to MONTH recurrence periods', () => {
    assert.deepEqual(recurrenceForPlan('monthly').recurrence_period, 1);
    assert.deepEqual(recurrenceForPlan('yearly').recurrence_period, 12);
    assert.deepEqual(recurrenceForPlan('club').recurrence_period, 12);
  });
});

describe('createGoPayProvider', () => {
  it('isConfigured requires credentials + notification URL', () => {
    assert.equal(createGoPayProvider(baseConfig()).isConfigured(), true);
    assert.equal(
      createGoPayProvider(baseConfig({ clientSecret: undefined })).isConfigured(),
      false,
    );
  });

  it('createCheckoutSession obtains a token and returns gw_url', async () => {
    const calls = mockFetchSequence([
      {
        body: { access_token: 'tok', expires_in: 1800, token_type: 'bearer' },
      },
      {
        body: {
          id: 3123456789,
          gw_url: 'https://gw.sandbox.gopay.com/gw/v3/abc',
          state: 'CREATED',
        },
      },
    ]);
    const provider = createGoPayProvider(baseConfig());
    const session = await provider.createCheckoutSession({
      userId: 'user-1',
      email: 'a@example.com',
      planType: 'monthly',
      returnPath: '/account',
    });
    assert.equal(session.provider, 'gopay');
    assert.equal(session.checkoutUrl, 'https://gw.sandbox.gopay.com/gw/v3/abc');
    assert.equal(session.orderId, '3123456789');
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.url, /\/oauth2\/token$/);
    assert.match(calls[1]!.url, /\/payments\/payment$/);
    const paymentBody = JSON.parse(String(calls[1]!.init?.body ?? '{}')) as {
      amount: number;
      recurrence: { recurrence_period: number };
      additional_params: Array<{ name: string; value: string }>;
    };
    assert.equal(paymentBody.amount, 19900);
    assert.equal(paymentBody.recurrence.recurrence_period, 1);
    assert.ok(
      paymentBody.additional_params.some((p) => p.name === 'userId' && p.value === 'user-1'),
    );
  });

  it('handleWebhook re-fetches payment status and normalizes PAID parent to checkout.completed', async () => {
    mockFetchSequence([
      { body: { access_token: 'tok', expires_in: 1800 } },
      {
        body: {
          id: 99,
          state: 'PAID',
          additional_params: [
            { name: 'userId', value: 'u1' },
            { name: 'planType', value: 'monthly' },
          ],
        },
      },
    ]);
    const provider = createGoPayProvider(baseConfig());
    const event = await provider.handleWebhook(JSON.stringify({ id: '99' }));
    assert.equal(event.type, 'checkout.completed');
    assert.equal(event.providerId, 'gopay');
    assert.equal(event.userId, 'u1');
    assert.equal(event.subscriptionId, '99');
  });

  it('handleWebhook maps child recurrence PAID to invoice.paid', async () => {
    mockFetchSequence([
      { body: { access_token: 'tok', expires_in: 1800 } },
      {
        body: {
          id: 100,
          parent_id: 99,
          state: 'PAID',
          additional_params: [{ name: 'planType', value: 'yearly' }],
        },
      },
    ]);
    const provider = createGoPayProvider(baseConfig());
    const event = await provider.handleWebhook(JSON.stringify({ id: '100', parent_id: '99' }));
    assert.equal(event.type, 'invoice.paid');
    assert.equal(event.subscriptionId, '99');
    assert.equal(event.providerOrderId, '100');
  });

  it('cancelSubscription calls void-recurrence', async () => {
    const calls = mockFetchSequence([
      { body: { access_token: 'tok', expires_in: 1800 } },
      { body: { id: 99, result: 'FINISHED' } },
    ]);
    const provider = createGoPayProvider(baseConfig());
    await provider.cancelSubscription('99');
    assert.match(calls[1]!.url, /\/void-recurrence$/);
  });
});
