/** localStorage key — explicit consent for PostHog product analytics. */
export const POSTHOG_ANALYTICS_CONSENT_KEY = 'vmp_posthog_analytics_consent';

export type PostHogConsentValue = 'granted' | 'denied';

/** Synchronous consent read for capture helpers (no Vue lifecycle). */
export function hasPostHogAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(POSTHOG_ANALYTICS_CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

type PostHogPersistenceClient = {
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  set_config?: (config: { persistence?: string }) => void;
};

/** Apply consent to an initialized PostHog client (memory-only until granted). */
export function applyPostHogConsentToClient(client: PostHogPersistenceClient, granted: boolean): void {
  if (granted) {
    client.set_config?.({ persistence: 'localStorage+cookie' });
    client.opt_in_capturing?.();
    return;
  }
  client.set_config?.({ persistence: 'memory' });
  client.opt_out_capturing?.();
}
