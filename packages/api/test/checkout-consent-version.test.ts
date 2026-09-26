import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHECKOUT_CONSENT_VERSION } from '@vmp/shared';
import { resolveCheckoutConsentVersion, shortConsentTextHash } from '../src/checkoutConsent.js';

describe('resolveCheckoutConsentVersion', () => {
  it('keeps the canonical version when no override text is present', async () => {
    assert.equal(await resolveCheckoutConsentVersion(undefined), CHECKOUT_CONSENT_VERSION);
    assert.equal(await resolveCheckoutConsentVersion(''), CHECKOUT_CONSENT_VERSION);
    assert.equal(await resolveCheckoutConsentVersion('   '), CHECKOUT_CONSENT_VERSION);
  });

  it('appends a short hash of admin override wording', async () => {
    const override = 'I agree to the custom checkout terms.';
    const hash = await shortConsentTextHash(override);
    assert.equal(hash.length, 8);
    assert.equal(
      await resolveCheckoutConsentVersion(override),
      `${CHECKOUT_CONSENT_VERSION}:${hash}`,
    );
  });
});
