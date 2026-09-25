import { getBrowserPostHog } from '~/utils/posthogBrowserClient';
import { canCapturePostHogAnalytics } from '~/utils/posthogConsent';

function posthogEnvironmentProperty(): Record<string, unknown> {
  if (typeof window === 'undefined') return { $environment: 'development' };
  const nuxtPublic = (
    window as Window & { __NUXT__?: { config?: { public?: { deployTier?: string } } } }
  ).__NUXT__?.config?.public;
  const tier = String(nuxtPublic?.deployTier ?? 'development').trim();
  return { $environment: tier || 'development' };
}

/**
 * Capture a snake_case product event when the browser PostHog client is initialized.
 *
 * Resolves the client via `getBrowserPostHog()` (`$posthog` from `@posthog/nuxt`, then
 * `window.posthog`). `@posthog/nuxt` does not assign `window.posthog`, so looking only at
 * the window global silently dropped every custom product event.
 */
export function capturePostHogEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  try {
    const client = getBrowserPostHog();
    if (!client || typeof client.capture !== 'function') return;
    client.capture(event, { ...posthogEnvironmentProperty(), ...properties });
  } catch {
    // Best-effort: analytics must not break product flows.
  }
}
