/**
 * Prefetch Stripe.js after auth init so checkout Payment Element does not wait
 * on a cold script download when the user opens subscribe.
 */
import { prefetchStripeJs } from '~/utils/stripeClient';

export default defineNuxtPlugin(() => {
  if (import.meta.server) return;

  const schedule =
    typeof window.requestIdleCallback === 'function'
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 4000 })
      : (cb: () => void) => window.setTimeout(cb, 1200);

  schedule(() => {
    prefetchStripeJs();
  });
});
