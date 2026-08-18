import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeStripeInvoice } from '../src/providers/stripe/invoice.js';

describe('normalizeStripeInvoice', () => {
  it('maps Stripe invoice.paid payload to NormalizedInvoiceData', () => {
    const invoice = normalizeStripeInvoice(
      {
        id: 'in_123',
        currency: 'eur',
        subtotal: 999,
        tax: 0,
        total: 999,
        created: 1_700_000_000,
        status_transitions: { paid_at: 1_700_000_100 },
        payment_intent: 'pi_abc',
        subscription: 'sub_xyz',
        customer_email: 'buyer@example.com',
        customer_name: 'Buyer s.r.o.',
        lines: {
          data: [
            {
              description: 'Monthly plan',
              quantity: 1,
              amount_excluding_tax: 999,
              tax_amounts: [],
            },
          ],
        },
      },
      { planType: 'monthly' },
    );

    assert.ok(invoice);
    assert.equal(invoice.providerInvoiceId, 'in_123');
    assert.equal(invoice.providerPaymentId, 'pi_abc');
    assert.equal(invoice.providerSubscriptionId, 'sub_xyz');
    assert.equal(invoice.currency, 'EUR');
    assert.equal(invoice.netAmountCents, 999);
    assert.equal(invoice.buyer.email, 'buyer@example.com');
    assert.equal(invoice.lineItems.length, 1);
    assert.match(invoice.lineItems[0]!.description, /Monthly plan/);
  });

  it('returns null when invoice id is missing', () => {
    assert.equal(normalizeStripeInvoice({}), null);
  });
});
