import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCheckoutPaymentSurfaces } from '../utils/checkoutPaymentSurfaces';

describe('resolveCheckoutPaymentSurfaces', () => {
  it('keeps probing wallets before detection finishes', () => {
    const s = resolveCheckoutPaymentSurfaces({
      walletDetectionDone: false,
      walletAvailable: false,
      stripeCheckoutReady: true,
      moreExpanded: false,
      cardMethodSelected: false,
      hasSecondaryProviders: false,
    });
    assert.equal(s.showWalletSurface, true);
    assert.equal(s.showCardSurface, false);
    assert.equal(s.showMoreToggle, false);
    assert.equal(s.showCardPaymentOption, false);
  });

  it('opens card immediately when no express wallets (no More / Pay by card)', () => {
    const s = resolveCheckoutPaymentSurfaces({
      walletDetectionDone: true,
      walletAvailable: false,
      stripeCheckoutReady: true,
      moreExpanded: false,
      cardMethodSelected: true,
      hasSecondaryProviders: false,
    });
    assert.equal(s.showWalletSurface, false);
    assert.equal(s.showCardSurface, true);
    assert.equal(s.showMoreToggle, false);
    assert.equal(s.showCardPaymentOption, false);
  });

  it('keeps More for secondary providers when wallets are absent', () => {
    const s = resolveCheckoutPaymentSurfaces({
      walletDetectionDone: true,
      walletAvailable: false,
      stripeCheckoutReady: true,
      moreExpanded: false,
      cardMethodSelected: true,
      hasSecondaryProviders: true,
    });
    assert.equal(s.showCardSurface, true);
    assert.equal(s.showMoreToggle, true);
    assert.equal(s.showCardPaymentOption, false);
  });

  it('puts card behind More → Pay by card when Apple/Google Pay is available', () => {
    const closed = resolveCheckoutPaymentSurfaces({
      walletDetectionDone: true,
      walletAvailable: true,
      stripeCheckoutReady: true,
      moreExpanded: false,
      cardMethodSelected: false,
      hasSecondaryProviders: false,
    });
    assert.equal(closed.showWalletSurface, true);
    assert.equal(closed.showCardSurface, false);
    assert.equal(closed.showMoreToggle, true);
    assert.equal(closed.showCardPaymentOption, true);

    const open = resolveCheckoutPaymentSurfaces({
      walletDetectionDone: true,
      walletAvailable: true,
      stripeCheckoutReady: true,
      moreExpanded: true,
      cardMethodSelected: true,
      hasSecondaryProviders: false,
    });
    assert.equal(open.showCardSurface, true);
  });
});
