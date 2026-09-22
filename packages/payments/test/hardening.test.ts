import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGoPaySandboxApiBase, timingSafeEqualString } from '../src/index.js';
import { normalizeRedirectGatewayInvoice } from '../src/providers/redirectInvoice.js';

describe('timingSafeEqualString', () => {
  it('matches equal secrets', () => {
    assert.equal(timingSafeEqualString('abc', 'abc'), true);
  });

  it('rejects unequal secrets and length mismatches', () => {
    assert.equal(timingSafeEqualString('abc', 'abd'), false);
    assert.equal(timingSafeEqualString('abc', 'ab'), false);
  });
});

describe('isGoPaySandboxApiBase', () => {
  it('treats empty and sandbox hosts as sandbox', () => {
    assert.equal(isGoPaySandboxApiBase(''), true);
    assert.equal(isGoPaySandboxApiBase('https://gw.sandbox.gopay.com/api'), true);
    assert.equal(isGoPaySandboxApiBase('https://gw.sandbox.gopay.com/api/'), true);
    assert.equal(isGoPaySandboxApiBase('https://sandbox.gopay.com/api'), true);
  });

  it('treats production gate as non-sandbox', () => {
    assert.equal(isGoPaySandboxApiBase('https://gate.gopay.cz/api'), false);
  });

  it('does not treat sandbox substring in path or query as sandbox', () => {
    assert.equal(isGoPaySandboxApiBase('https://evil.example/sandbox.gopay.com'), false);
    assert.equal(isGoPaySandboxApiBase('https://evil.example/?host=sandbox.gopay.com'), false);
    assert.equal(isGoPaySandboxApiBase('https://not-sandbox.gopay.com.evil/api'), false);
  });
});

describe('normalizeRedirectGatewayInvoice', () => {
  it('builds a gross-only invoice payload', () => {
    const invoice = normalizeRedirectGatewayInvoice({
      providerInvoiceId: 'pay-1',
      amountMinor: 19900,
      currency: 'czk',
      email: 'a@example.com',
      planType: 'monthly',
    });
    assert.ok(invoice);
    assert.equal(invoice?.grossAmountCents, 19900);
    assert.equal(invoice?.taxAmountCents, 0);
    assert.equal(invoice?.currency, 'CZK');
    assert.equal(invoice?.buyer.email, 'a@example.com');
    assert.equal(invoice?.lineItems[0]?.description, 'VMP monthly');
  });

  it('returns null without id or positive amount', () => {
    assert.equal(
      normalizeRedirectGatewayInvoice({
        providerInvoiceId: '',
        amountMinor: 100,
        currency: 'CZK',
      }),
      null,
    );
    assert.equal(
      normalizeRedirectGatewayInvoice({
        providerInvoiceId: 'x',
        amountMinor: 0,
        currency: 'CZK',
      }),
      null,
    );
  });
});
