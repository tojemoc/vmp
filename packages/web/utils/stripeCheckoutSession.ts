/**
 * Helpers for displaying Checkout Session totals from Stripe.js loadActions().getSession().
 * Stripe requires reading session amount/currency into the UI (adaptive pricing / localization).
 *
 * Line-item shape matches `@stripe/stripe-js` `StripeCheckoutLineItem`:
 * prefer `total.amount` (line total) over `unitAmount.amount`.
 */

export type StripeCheckoutTotalAmount = {
  amount?: string;
  minorUnitsAmount?: number;
};

export type StripeCheckoutSessionSnapshot = {
  currency?: string;
  minorUnitsAmountDivisor?: number;
  lineItems?: Array<{
    name?: string;
    quantity?: number;
    /** Stripe Checkout Sessions API line-item total (qty × unit − discounts). */
    total?: StripeCheckoutTotalAmount;
    unitAmount?: StripeCheckoutTotalAmount;
    /** Legacy / defensive aliases — not present on current stripe-js types. */
    totalAmount?: StripeCheckoutTotalAmount;
    amountTotal?: StripeCheckoutTotalAmount;
  }>;
  total?: {
    total?: StripeCheckoutTotalAmount;
    subtotal?: StripeCheckoutTotalAmount;
  };
};

/** Prefer Stripe's pre-formatted amount string from the Checkout Session. */
export function formatCheckoutSessionTotal(session: StripeCheckoutSessionSnapshot | null): string {
  const formatted = session?.total?.total?.amount?.trim();
  if (formatted) return formatted;
  const minor = session?.total?.total?.minorUnitsAmount;
  const divisor = session?.minorUnitsAmountDivisor;
  const currency = session?.currency?.toUpperCase();
  if (
    typeof minor === 'number' &&
    Number.isFinite(minor) &&
    typeof divisor === 'number' &&
    divisor > 0 &&
    currency
  ) {
    const major = minor / divisor;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
    } catch {
      return `${major.toFixed(2)} ${currency}`;
    }
  }
  return '';
}

export function formatCheckoutSessionLineItems(
  session: StripeCheckoutSessionSnapshot | null,
): string[] {
  const items = session?.lineItems;
  if (!Array.isArray(items) || !items.length) return [];
  return items
    .map((item) => {
      const name = String(item.name ?? '').trim() || 'Item';
      const qty =
        typeof item.quantity === 'number' && item.quantity > 1 ? ` × ${item.quantity}` : '';
      const amount =
        item.total?.amount?.trim() ||
        item.totalAmount?.amount?.trim() ||
        item.amountTotal?.amount?.trim() ||
        item.unitAmount?.amount?.trim() ||
        '';
      return amount ? `${name}${qty} — ${amount}` : `${name}${qty}`;
    })
    .filter(Boolean);
}
