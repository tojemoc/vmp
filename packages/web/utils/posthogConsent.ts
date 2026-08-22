/** localStorage key — explicit consent for PostHog product analytics. */
export const POSTHOG_ANALYTICS_CONSENT_KEY = 'vmp_posthog_analytics_consent';

export type PostHogConsentValue = 'granted' | 'denied';

/** Synchronous consent read for capture helpers (no Vue lifecycle). */
export function hasPostHogAnalyticsConsent(): boolean {
  return readPostHogAnalyticsConsent() === 'granted';
}

/** Read stored grant/deny without Vue (safe from PostHog `loaded` callback). */
export function readPostHogAnalyticsConsent(): PostHogConsentValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(POSTHOG_ANALYTICS_CONSENT_KEY);
    if (raw === 'granted' || raw === 'denied') return raw;
  } catch {
    // Treat unreadable storage as unset.
  }
  return null;
}

type PostHogPersistence = 'memory' | 'localStorage' | 'sessionStorage' | 'localStorage+cookie' | 'cookie';

export type PostHogPersistenceClient = {
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  set_config?: (config: { persistence?: PostHogPersistence }) => void;
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

/**
 * Re-read localStorage and apply to the client. Call from PostHog `loaded` so a
 * prior grant still gets opt_in_capturing after init (opt_out_capturing_by_default).
 */
export function applyStoredPostHogConsentToClient(client: PostHogPersistenceClient): void {
  const stored = readPostHogAnalyticsConsent();
  if (stored === null) {
    // Undecided — stay opted out / memory (matches opt_out_capturing_by_default).
    applyPostHogConsentToClient(client, false);
    return;
  }
  applyPostHogConsentToClient(client, stored === 'granted');
}
