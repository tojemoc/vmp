import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canAccessIrlEvent, hasAdFreeEntitlement, shouldShowAds } from '@vmp/shared';

describe('IRL + ad-free API entitlement contracts', () => {
  it('matches plan rules used by irlEvents handlers', () => {
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'club', role: 'viewer' }), true);
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'monthly', role: 'viewer' }), false);
  });

  it('matches ad-free rules used by ads_enabled feature flag', () => {
    assert.equal(hasAdFreeEntitlement({ planType: 'club', role: 'viewer' }), true);
    assert.equal(shouldShowAds({ adsEnabled: true, planType: 'yearly', role: 'viewer' }), true);
    assert.equal(shouldShowAds({ adsEnabled: true, planType: 'club', role: 'viewer' }), false);
  });
});
