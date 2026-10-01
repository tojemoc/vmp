import { isPostHogFlagshipCompiled } from '~/utils/posthogFlagshipGate';

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

export type PostHogPersistenceClient = {
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  is_capturing?: () => boolean;
  set_config?: (config: Record<string, unknown>) => void;
  config?: {
    metrics?: Record<string, unknown>;
  };
};

/** True when Flagship `posthog` is on and explicit product-analytics consent allows capture. */
export function canCapturePostHogAnalytics(): boolean {
  return isPostHogFlagshipCompiled() && hasPostHogAnalyticsConsent();
}

/** Web PostHog metrics resource defaults (must be re-applied when toggling network). */
export const VMP_WEB_POSTHOG_METRICS_BASE = {
  serviceName: 'vmp-web',
} as const;

/**
 * Enable/disable automatic fetch/XHR network metrics with analytics consent.
 * Shallow `set_config({ metrics })` replaces the whole metrics object, so we
 * always re-send serviceName/environment alongside `network`.
 */
export function syncPostHogMetricsNetworkConsent(
  client: PostHogPersistenceClient,
  granted: boolean,
): void {
  if (typeof client.set_config !== 'function') return;
  const existing = client.config?.metrics ?? {};
  const environment =
    typeof existing.environment === 'string' && existing.environment.trim()
      ? existing.environment.trim()
      : undefined;
  client.set_config({
    metrics: {
      ...VMP_WEB_POSTHOG_METRICS_BASE,
      ...(environment ? { environment } : {}),
      ...existing,
      network: granted,
    },
  });
}

/**
 * Apply explicit consent with PostHog cookieless_mode: "on_reject".
 * Grant → opt_in (cookies + identify). Deny → opt_out (cookieless hash counts).
 * Also toggles metrics.network so request instrumentation stops without consent.
 * PostHog manages persistence; do not set persistence manually.
 */
export function applyPostHogConsentToClient(
  client: PostHogPersistenceClient,
  granted: boolean,
): void {
  syncPostHogMetricsNetworkConsent(client, granted);
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
