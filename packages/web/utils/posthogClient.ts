import { getBrowserPostHog } from '~/utils/posthogBrowserClient';
import { canCapturePostHogAnalytics } from '~/utils/posthogConsent';

export type PostHogMetricAttributes = Record<string, string | number | boolean>;

export type CapturePostHogMetricOptions = {
  unit?: string;
  attributes?: PostHogMetricAttributes;
};

type PostHogMetricsApi = {
  count?: (name: string, value?: number, options?: CapturePostHogMetricOptions) => void;
  gauge?: (name: string, value: number, options?: CapturePostHogMetricOptions) => void;
  histogram?: (name: string, value: number, options?: CapturePostHogMetricOptions) => void;
  flush?: () => Promise<void>;
};

function posthogEnvironmentProperty(): Record<string, unknown> {
  if (typeof window === 'undefined') return { $environment: 'development' };
  const nuxtPublic = (
    window as Window & { __NUXT__?: { config?: { public?: { deployTier?: string } } } }
  ).__NUXT__?.config?.public;
  const tier = String(nuxtPublic?.deployTier ?? 'development').trim();
  return { $environment: tier || 'development' };
}

function getBrowserPostHogMetrics(): PostHogMetricsApi | undefined {
  const client = getBrowserPostHog() as
    | (ReturnType<typeof getBrowserPostHog> & { metrics?: PostHogMetricsApi })
    | undefined;
  return client?.metrics;
}

/**
 * Keep only low-cardinality scalar attributes for metric series.
 * Drops objects, empty strings, and UUID-/token-shaped values.
 */
export function lowCardinalityMetricAttributes(
  properties: Record<string, unknown> = {},
): PostHogMetricAttributes {
  const attributes: PostHogMetricAttributes = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      attributes[key] = value;
      continue;
    }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 64) continue;
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ) {
      continue;
    }
    if (/^[0-9a-f]{16,}$/i.test(trimmed)) continue;
    attributes[key] = trimmed;
  }
  return attributes;
}

/**
 * Capture a snake_case product event when the browser PostHog client is initialized.
 *
 * Resolves the client via `getBrowserPostHog()` (`$posthog` from `@posthog/nuxt`, then
 * `window.posthog`). `@posthog/nuxt` does not assign `window.posthog`, so looking only at
 * the window global silently dropped every custom product event.
 *
 * Also records a matching application metric counter (PostHog Metrics alpha) with
 * low-cardinality attributes only — never user IDs.
 */
export function capturePostHogEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  try {
    const client = getBrowserPostHog();
    if (!client || typeof client.capture !== 'function') return;
    client.capture(event, { ...posthogEnvironmentProperty(), ...properties });
    recordPostHogCount(event, 1, {
      attributes: lowCardinalityMetricAttributes(properties),
    });
  } catch {
    // Best-effort: analytics must not break product flows.
  }
}

/** Increment a PostHog application metric counter (requires analytics consent). */
export function recordPostHogCount(
  name: string,
  value = 1,
  options: CapturePostHogMetricOptions = {},
): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  const metricName = name.trim();
  if (!metricName || !Number.isFinite(value) || value < 0) return;
  try {
    getBrowserPostHogMetrics()?.count?.(metricName, value, options);
  } catch {
    // Best-effort.
  }
}

/** Record a PostHog gauge sample (requires analytics consent). */
export function recordPostHogGauge(
  name: string,
  value: number,
  options: CapturePostHogMetricOptions = {},
): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  const metricName = name.trim();
  if (!metricName || !Number.isFinite(value)) return;
  try {
    getBrowserPostHogMetrics()?.gauge?.(metricName, value, options);
  } catch {
    // Best-effort.
  }
}

/** Record a PostHog histogram observation (requires analytics consent). */
export function recordPostHogHistogram(
  name: string,
  value: number,
  options: CapturePostHogMetricOptions = {},
): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  const metricName = name.trim();
  if (!metricName || !Number.isFinite(value)) return;
  try {
    getBrowserPostHogMetrics()?.histogram?.(metricName, value, options);
  } catch {
    // Best-effort.
  }
}
