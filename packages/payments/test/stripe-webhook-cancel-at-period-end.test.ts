import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createStripeProvider } from '../src/providers/stripe/index.js';

function subscriptionUpdatedPayload(cancelAtPeriodEnd: boolean) {
  return JSON.stringify({
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_test',
        customer: 'cus_test',
        status: 'active',
        cancel_at_period_end: cancelAtPeriodEnd,
        metadata: { userId: 'user_1', planType: 'monthly' },
      },
    },
  });
}

describe('createStripeProvider().handleWebhook customer.subscription.updated', () => {
  const provider = createStripeProvider({
    secretKey: 'sk_test',
    webhookSecret: 'whsec_test',
    frontendUrl: 'https://example.test',
    priceIdForPlan: async () => 'price_test',
  });

  it('maps cancel_at_period_end true to cancelAtPeriodEnd true', async () => {
    const event = await provider.handleWebhook(subscriptionUpdatedPayload(true));
    assert.equal(event.type, 'subscription.updated');
    assert.equal(event.status, 'active');
    assert.equal(event.cancelAtPeriodEnd, true);
    assert.equal(event.subscriptionId, 'sub_test');
    assert.equal(event.customerId, 'cus_test');
  });

  it('maps cancel_at_period_end false to cancelAtPeriodEnd false', async () => {
    const event = await provider.handleWebhook(subscriptionUpdatedPayload(false));
    assert.equal(event.type, 'subscription.updated');
    assert.equal(event.status, 'active');
    assert.equal(event.cancelAtPeriodEnd, false);
    assert.equal(event.subscriptionId, 'sub_test');
  });
});
