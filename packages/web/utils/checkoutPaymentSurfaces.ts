/**
 * Checkout payment-surface visibility — Express wallets vs card Payment Element.
 * Kept pure so unit tests cover the "no Apple/Google Pay → skip two clicks" path.
 */

export type CheckoutPaymentSurfaceInput = {
  walletDetectionDone: boolean;
  walletAvailable: boolean;
  stripeCheckoutReady: boolean;
  moreExpanded: boolean;
  cardMethodSelected: boolean;
  hasSecondaryProviders: boolean;
};

export type CheckoutPaymentSurfaces = {
  showWalletSurface: boolean;
  showCardSurface: boolean;
  showMoreToggle: boolean;
  showCardPaymentOption: boolean;
};

export function resolveCheckoutPaymentSurfaces(
  input: CheckoutPaymentSurfaceInput,
): CheckoutPaymentSurfaces {
  const showWalletSurface = !input.walletDetectionDone || input.walletAvailable;

  let showCardSurface = false;
  if (input.walletDetectionDone && input.stripeCheckoutReady) {
    showCardSurface = !input.walletAvailable
      ? true
      : input.moreExpanded && input.cardMethodSelected;
  }

  let showMoreToggle = false;
  if (input.walletDetectionDone) {
    showMoreToggle = input.walletAvailable || input.hasSecondaryProviders;
  }

  const showCardPaymentOption =
    input.walletAvailable && input.stripeCheckoutReady && showMoreToggle;

  return {
    showWalletSurface,
    showCardSurface,
    showMoreToggle,
    showCardPaymentOption,
  };
}
