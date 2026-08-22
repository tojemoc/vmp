import { hasPostHogAnalyticsConsent } from '~/utils/posthogConsent';

type PostHogCaptureClient = {
  capture: (event: string, properties?: Record<string, unknown>) => unknown;
};

function getPostHogClient(): PostHogCaptureClient | undefined {
  if (typeof window === 'undefined') return undefined;
  const client = (window as Window & { posthog?: PostHogCaptureClient }).posthog;
  if (!client || typeof client.capture !== 'function') return undefined;
  return client;
}

/** Capture a snake_case product event when the browser PostHog client is initialized. */
export function capturePostHogEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (import.meta.server) return;
  if (!hasPostHogAnalyticsConsent()) return;
  try {
    getPostHogClient()?.capture(event, properties);
  } catch {
    // Best-effort: analytics must not break product flows.
  }
}
