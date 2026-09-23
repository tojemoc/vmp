import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAccessIrlEvent,
  hasAdFreeEntitlement,
  isClubPlanType,
  shouldShowAds,
} from '@vmp/shared';

describe('club entitlements helpers', () => {
  it('detects club plan types', () => {
    assert.equal(isClubPlanType('club'), true);
    assert.equal(isClubPlanType('Club'), true);
    assert.equal(isClubPlanType('yearly'), false);
    assert.equal(isClubPlanType(null), false);
  });

  it('grants ad-free to club and staff only', () => {
    assert.equal(hasAdFreeEntitlement({ planType: 'club', role: 'viewer' }), true);
    assert.equal(hasAdFreeEntitlement({ planType: 'monthly', role: 'admin' }), true);
    assert.equal(hasAdFreeEntitlement({ planType: 'yearly', role: 'viewer' }), false);
    assert.equal(hasAdFreeEntitlement({ planType: null, role: null }), false);
  });

  it('shows ads only when globally enabled and viewer is not ad-free', () => {
    assert.equal(shouldShowAds({ adsEnabled: false, planType: 'monthly', role: 'viewer' }), false);
    assert.equal(shouldShowAds({ adsEnabled: true, planType: 'monthly', role: 'viewer' }), true);
    assert.equal(shouldShowAds({ adsEnabled: true, planType: 'club', role: 'viewer' }), false);
    assert.equal(shouldShowAds({ adsEnabled: true, planType: 'monthly', role: 'editor' }), false);
  });

  it('gates club-only IRL events', () => {
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'club', role: 'viewer' }), true);
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'monthly', role: 'viewer' }), false);
    assert.equal(canAccessIrlEvent({ clubOnly: true, planType: 'monthly', role: 'admin' }), true);
    assert.equal(canAccessIrlEvent({ clubOnly: false, planType: 'monthly', role: 'viewer' }), true);
  });
});
