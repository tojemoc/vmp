import { canCapturePostHogAnalytics } from '~/utils/posthogConsent';

type PostHogCaptureClient = {
  capture: (event: string, properties?: Record<string, unknown>) => unknown;
};

function posthogEnvironmentProperty(): Record<string, unknown> {
  if (typeof window === 'undefined') return { $environment: 'development' };
  const nuxtPublic = (
    window as Window & { __NUXT__?: { config?: { public?: { deployTier?: string } } } }
  ).__NUXT__?.config?.public;
  const tier = String(nuxtPublic?.deployTier ?? 'development').trim();
  return { $environment: tier || 'development' };
}

function getPostHogClient(): PostHogCaptureClient | undefined {
  if (typeof window === 'undefined') return undefined;
  const client = (window as Window & { posthog?: PostHogCaptureClient }).posthog;
  if (!client || typeof client.capture !== 'function') return undefined;
  return client;
}

/** Capture a snake_case product event when the browser PostHog client is initialized. */
export function capturePostHogEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  try {
    getPostHogClient()?.capture(event, { ...posthogEnvironmentProperty(), ...properties });
  } catch {
    // Best-effort: analytics must not break product flows.
  }
}
