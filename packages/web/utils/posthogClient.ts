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

/** Explicit allowlist of metric attribute keys and permitted string values. */
const APPROVED_METRIC_STRING_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  plan_type: new Set(['monthly', 'yearly', 'club']),
  provider: new Set(['stripe', 'gopay', 'comgate', 'qerko', 'legacy', 'unknown']),
  client: new Set(['browser', 'pwa', 'native']),
  surface: new Set([
    'inline_auth',
    'login',
    'header',
    'checkout',
    'web_verify',
    'pwa_handoff',
    'pwa_handoff_safari',
    'pwa_handoff_redeem',
    'watch_player_init',
  ]),
  rendition: new Set(['480p', '720p', '1080p']),
  reason: new Set(['redeem_error', 'verify_error', 'missing_token']),
};

const APPROVED_METRIC_BOOLEAN_ATTRIBUTES = new Set(['optedOut']);

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
 * Keep only explicitly approved, bounded metric dimensions.
 * Identifiers (video_id, user ids) and unknown keys are dropped.
 */
export function approvedMetricAttributes(
  properties: Record<string, unknown> = {},
): PostHogMetricAttributes {
  const attributes: PostHogMetricAttributes = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    if (APPROVED_METRIC_BOOLEAN_ATTRIBUTES.has(key)) {
      if (typeof value === 'boolean') attributes[key] = value;
      continue;
    }
    const allowed = APPROVED_METRIC_STRING_ATTRIBUTES[key];
    if (!allowed) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!allowed.has(trimmed)) continue;
    attributes[key] = trimmed;
  }
  return attributes;
}

/** @deprecated Prefer {@link approvedMetricAttributes}. */
export const lowCardinalityMetricAttributes = approvedMetricAttributes;

function sanitizeMetricOptions(
  options: CapturePostHogMetricOptions = {},
): CapturePostHogMetricOptions {
  const attributes = approvedMetricAttributes(options.attributes ?? {});
  return {
    ...(options.unit ? { unit: options.unit } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}

/**
 * Capture a snake_case product event when the browser PostHog client is initialized.
 *
 * Resolves the client via `getBrowserPostHog()` (`$posthog` from `@posthog/nuxt`, then
 * `window.posthog`). `@posthog/nuxt` does not assign `window.posthog`, so looking only at
 * the window global silently dropped every custom product event.
 *
 * Also records a matching application metric counter (PostHog Metrics alpha) with
 * allowlisted attributes only — never user IDs.
 */
export function capturePostHogEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (import.meta.server) return;
  if (!canCapturePostHogAnalytics()) return;
  try {
    const client = getBrowserPostHog();
    if (!client || typeof client.capture !== 'function') return;
    client.capture(event, { ...posthogEnvironmentProperty(), ...properties });
    recordPostHogCount(event, 1, {
      attributes: approvedMetricAttributes(properties),
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
    getBrowserPostHogMetrics()?.count?.(metricName, value, sanitizeMetricOptions(options));
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
    getBrowserPostHogMetrics()?.gauge?.(metricName, value, sanitizeMetricOptions(options));
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
    getBrowserPostHogMetrics()?.histogram?.(metricName, value, sanitizeMetricOptions(options));
  } catch {
    // Best-effort.
  }
}
