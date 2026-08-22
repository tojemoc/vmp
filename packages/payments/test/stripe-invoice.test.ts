import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractBuyerFromStripeInvoice,
  normalizeStripeInvoice,
} from '../src/providers/stripe/invoice.js';

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

  it('uses effective_at for issueDate when paid_at is later (delayed payment)', () => {
    const invoice = normalizeStripeInvoice({
      id: 'in_delayed',
      currency: 'eur',
      effective_at: 1_700_000_000,
      created: 1_699_999_000,
      status_transitions: { finalized_at: 1_700_000_050, paid_at: 1_700_100_000 },
      total_excluding_tax: 999,
      tax: 0,
      total: 999,
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
    });

    assert.ok(invoice);
    assert.equal(invoice.issueDate, '2023-11-14');
    assert.notEqual(invoice.issueDate, '2023-11-15');
  });

  it('reflects invoice-level discount in net totals and line items', () => {
    const invoice = normalizeStripeInvoice({
      id: 'in_disc',
      currency: 'eur',
      subtotal: 1000,
      total_excluding_tax: 800,
      tax: 0,
      total: 800,
      created: 1_700_000_000,
      lines: {
        data: [
          {
            description: 'Monthly plan',
            quantity: 1,
            amount_excluding_tax: 1000,
            tax_amounts: [],
          },
        ],
      },
    });

    assert.ok(invoice);
    assert.equal(invoice.netAmountCents, 800);
    const discountLine = invoice.lineItems.find((line) => line.description === 'Discount');
    assert.ok(discountLine);
    assert.equal(discountLine!.netAmountCents, -200);
    const lineNetSum = invoice.lineItems.reduce((sum, line) => sum + line.netAmountCents, 0);
    assert.equal(lineNetSum, 800);
    assert.equal(invoice.grossAmountCents, 800);
  });
});

describe('extractBuyerFromStripeInvoice', () => {
  it('does not treat consumer display name as business without VAT or reverse charge', () => {
    const buyer = extractBuyerFromStripeInvoice({
      customer_email: 'john@example.com',
      customer_name: 'John Doe',
    });
    assert.equal(buyer.isBusiness, false);
  });

  it('treats reverse-charge tax exemption as a business indicator', () => {
    const buyer = extractBuyerFromStripeInvoice({
      customer_email: 'buyer@example.com',
      customer_tax_exempt: 'reverse',
    });
    assert.equal(buyer.isBusiness, true);
  });
});
