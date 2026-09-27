/**
 * Shared Stripe.js loader — prefetch early so Payment Element is not blocked
 * on first checkout open.
 */

import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

function resolveApiUrl(): string {
  try {
    const config = useRuntimeConfig();
    return String(config.public.apiUrl ?? '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * Load (or reuse) the Stripe.js instance for this origin.
 * Safe to call repeatedly; failures clear the cache so a later retry can succeed.
 */
export function getStripeJs(apiUrl = resolveApiUrl()): Promise<Stripe | null> {
  if (!apiUrl) return Promise.resolve(null);
  if (!stripePromise) {
    stripePromise = fetch(`${apiUrl}/api/payments/stripe-config`, { credentials: 'include' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { publishableKey?: string };
        const key = String(data.publishableKey ?? '').trim();
        if (!key) {
          // Clear cache so a later attempt can refetch after config recovers
          // (successful `.then` with null does not hit `.catch`).
          stripePromise = null;
          return null;
        }
        return loadStripe(key);
      })
      .catch(() => {
        stripePromise = null;
        return null;
      });
  }
  return stripePromise;
}

/** Fire-and-forget warmup for idle/boot paths. */
export function prefetchStripeJs(apiUrl = resolveApiUrl()): void {
  if (import.meta.server) return;
  void getStripeJs(apiUrl);
}
