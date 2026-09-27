import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatCheckoutSessionLineItems,
  formatCheckoutSessionTotal,
  type StripeCheckoutSessionSnapshot,
} from '../utils/stripeCheckoutSession';

describe('formatCheckoutSessionTotal', () => {
  it('prefers Stripe pre-formatted total.amount', () => {
    const session: StripeCheckoutSessionSnapshot = {
      currency: 'eur',
      minorUnitsAmountDivisor: 100,
      total: { total: { amount: '€9.99', minorUnitsAmount: 999 } },
    };
    assert.equal(formatCheckoutSessionTotal(session), '€9.99');
  });

  it('falls back to Intl formatting from minor units', () => {
    const session: StripeCheckoutSessionSnapshot = {
      currency: 'eur',
      minorUnitsAmountDivisor: 100,
      total: { total: { minorUnitsAmount: 999 } },
    };
    const formatted = formatCheckoutSessionTotal(session);
    assert.match(formatted, /9[,.]99/);
    assert.match(formatted.toUpperCase(), /EUR|€/);
  });

  it('returns empty string when session has no usable total', () => {
    assert.equal(formatCheckoutSessionTotal(null), '');
    assert.equal(formatCheckoutSessionTotal({}), '');
    assert.equal(formatCheckoutSessionTotal({ total: { total: {} } }), '');
  });
});

describe('formatCheckoutSessionLineItems', () => {
  it('formats name, quantity, and amount from session line items', () => {
    const session: StripeCheckoutSessionSnapshot = {
      lineItems: [
        // Stripe Checkout Sessions API: line total lives on `total.amount`
        { name: 'Monthly', quantity: 1, total: { amount: '€9.99' }, unitAmount: { amount: '€9.99' } },
        {
          name: 'Add-on',
          quantity: 2,
          total: { amount: '€4.00' },
          unitAmount: { amount: '€2.00' },
        },
      ],
    };
    assert.deepEqual(formatCheckoutSessionLineItems(session), [
      'Monthly — €9.99',
      'Add-on × 2 — €4.00',
    ]);
  });

  it('prefers line-item total.amount over unitAmount when they differ', () => {
    const session: StripeCheckoutSessionSnapshot = {
      lineItems: [
        {
          name: 'Yearly',
          quantity: 1,
          total: { amount: '€99.00' },
          unitAmount: { amount: '€120.00' },
        },
      ],
    };
    assert.deepEqual(formatCheckoutSessionLineItems(session), ['Yearly — €99.00']);
  });

  it('returns empty array when line items are missing', () => {
    assert.deepEqual(formatCheckoutSessionLineItems(null), []);
    assert.deepEqual(formatCheckoutSessionLineItems({}), []);
  });
});
