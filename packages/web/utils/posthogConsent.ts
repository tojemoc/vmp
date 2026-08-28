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

type PostHogPersistence =
  | 'memory'
  | 'localStorage'
  | 'sessionStorage'
  | 'localStorage+cookie'
  | 'cookie';

export type PostHogPersistenceClient = {
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  is_capturing?: () => boolean;
  set_config?: (config: { persistence?: PostHogPersistence }) => void;
};

/** True when product analytics events may be sent (full consent or cookieless-on-reject). */
export function canCapturePostHogAnalytics(): boolean {
  if (hasPostHogAnalyticsConsent()) return true;
  if (typeof window === 'undefined') return false;
  try {
    const client = (window as Window & { posthog?: PostHogPersistenceClient }).posthog;
    return client?.is_capturing?.() === true;
  } catch {
    return false;
  }
}

/**
 * Apply explicit consent with PostHog cookieless_mode: "on_reject".
 * Grant → opt_in (cookies + identify). Deny → opt_out (cookieless hash counts).
 * PostHog manages persistence; do not set persistence manually.
 */
export function applyPostHogConsentToClient(
  client: PostHogPersistenceClient,
  granted: boolean,
): void {
  if (granted) {
    client.opt_in_capturing?.();
    return;
  }
  client.opt_out_capturing?.();
}

/**
 * Re-read localStorage and apply to the client. Call from PostHog `loaded` so a
 * prior grant/deny is restored after init. When consent is still undecided, leave
 * PostHog in pending state (no capture until the banner choice).
 */
export function applyStoredPostHogConsentToClient(client: PostHogPersistenceClient): void {
  const stored = readPostHogAnalyticsConsent();
  if (stored === null) return;
  applyPostHogConsentToClient(client, stored === 'granted');
}
