import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  authFailureResponse,
  BillingAuthConfigError,
  isBillingAuthConfigError,
} from '../src/auth.js';
import { getBillingReadiness } from '../src/readiness.js';

describe('getBillingReadiness', () => {
  it('reports ready=false when required secrets are missing', () => {
    const readiness = getBillingReadiness({});
    assert.equal(readiness.service, 'vmp-billing');
    assert.equal(readiness.ok, true);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.missingRequired.sort(), [
      'JWT_SECRET',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
    assert.equal(readiness.providers.stripeSecretConfigured, false);
    assert.equal(readiness.providers.stripePublishableConfigured, false);
  });

  it('treats whitespace-only publishable key as missing', () => {
    const readiness = getBillingReadiness({
      JWT_SECRET: 'x'.repeat(32),
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_PUBLISHABLE_KEY: '   ',
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.secrets.STRIPE_PUBLISHABLE_KEY, false);
    assert.equal(readiness.providers.stripePublishableConfigured, false);
    assert.ok(readiness.missingRequired.includes('STRIPE_PUBLISHABLE_KEY'));
  });

  it('reports ready=true when JWT + Stripe secrets are set', () => {
    const readiness = getBillingReadiness({
      JWT_SECRET: 'x'.repeat(32),
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    });
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.missingRequired, []);
    assert.equal(readiness.secrets.JWT_SECRET, true);
    assert.equal(readiness.secrets.STRIPE_SECRET_KEY, true);
    assert.equal(readiness.secrets.STRIPE_PUBLISHABLE_KEY, true);
    assert.equal(readiness.providers.stripeSecretConfigured, true);
    assert.equal(readiness.providers.stripePublishableConfigured, true);
  });
});

describe('authFailureResponse', () => {
  it('returns 503 with billing_auth_misconfigured for missing JWT_SECRET', async () => {
    const res = authFailureResponse(new BillingAuthConfigError());
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'billing_auth_misconfigured');
    assert.equal(isBillingAuthConfigError(new Error('JWT_SECRET not configured')), true);
  });

  it('returns 401 for ordinary auth failures', async () => {
    const res = authFailureResponse(new Error('Invalid JWT signature'));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Unauthorized');
  });
});
