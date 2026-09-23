import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canAccessIrlEvent, hasAdFreeEntitlement, shouldShowAds } from '@vmp/shared';

describe('club entitlement UI contracts', () => {
  it('keeps ads off by default for all plans', () => {
    assert.equal(shouldShowAds({ adsEnabled: false, planType: 'monthly', role: 'viewer' }), false);
    assert.equal(shouldShowAds({ adsEnabled: false, planType: 'club', role: 'viewer' }), false);
  });

  it('documents club ad-free entitlement for the watch-page gate', () => {
    assert.equal(hasAdFreeEntitlement({ planType: 'club', role: 'viewer' }), true);
    assert.equal(shouldShowAds({ adsEnabled: true, planType: 'club', role: 'viewer' }), false);
  });

  it('documents club-only IRL access rules for account RSVP UI', () => {
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'yearly', role: 'viewer' }), false);
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'club', role: 'viewer' }), true);
  });
});
