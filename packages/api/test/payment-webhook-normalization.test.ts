import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createStripeProvider } from '@vmp/payments';

function createProvider() {
  return createStripeProvider({
    secretKey: 'sk_test_123',
    webhookSecret: 'whsec_123',
    frontendUrl: 'http://localhost:3000',
    priceIdForPlan: async () => 'price_test_123',
  });
}

describe('stripe webhook normalization', () => {
  it('normalizes checkout completion metadata through the provider', async () => {
    const provider = createProvider();
    const event = await provider.handleWebhook(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            subscription: 'sub_123',
            customer: 'cus_123',
            metadata: {
              userId: 'user_123',
              planType: 'yearly',
              promoCodeId: 'promo_123',
            },
          },
        },
      }),
    );

    assert.equal(event.type, 'checkout.completed');
    assert.equal(event.providerId, 'stripe');
    assert.equal(event.userId, 'user_123');
    assert.equal(event.planType, 'yearly');
    assert.equal(event.promoCodeId, 'promo_123');
    assert.equal(event.subscriptionId, 'sub_123');
    assert.equal(event.customerId, 'cus_123');
  });

  it('normalizes subscription lifecycle events with status and period end', async () => {
    const provider = createProvider();
    const event = await provider.handleWebhook(
      JSON.stringify({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_456',
            customer: 'cus_456',
            status: 'active',
            current_period_end: 1_700_000_000,
          },
        },
      }),
    );

    assert.equal(event.type, 'subscription.updated');
    assert.equal(event.subscriptionId, 'sub_456');
    assert.equal(event.customerId, 'cus_456');
    assert.equal(event.status, 'active');
    assert.equal(event.currentPeriodEnd, new Date(1_700_000_000 * 1000).toISOString());
  });

  it('maps failed invoice payments to subscription.past_due', async () => {
    const provider = createProvider();
    const event = await provider.handleWebhook(
      JSON.stringify({
        type: 'invoice.payment_failed',
        data: {
          object: {
            subscription: 'sub_failed',
            customer: 'cus_failed',
          },
        },
      }),
    );

    assert.equal(event.type, 'subscription.past_due');
    assert.equal(event.subscriptionId, 'sub_failed');
    assert.equal(event.customerId, 'cus_failed');
    assert.equal(event.status, 'past_due');
  });

  it('attaches normalized invoice data on invoice.paid', async () => {
    const provider = createProvider();
    const event = await provider.handleWebhook(
      JSON.stringify({
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_789',
            currency: 'eur',
            subtotal: 1999,
            tax: 0,
            total: 1999,
            created: 1_700_000_000,
            subscription: 'sub_789',
            customer: 'cus_789',
            customer_email: 'pay@example.com',
            lines: { data: [{ description: 'Yearly', quantity: 1, amount_excluding_tax: 1999 }] },
          },
        },
      }),
    );

    assert.equal(event.type, 'invoice.paid');
    assert.equal(event.subscriptionId, 'sub_789');
    assert.ok(event.invoice);
    assert.equal(event.invoice?.providerInvoiceId, 'in_789');
    assert.equal(event.invoice?.grossAmountCents, 1999);
  });
});
