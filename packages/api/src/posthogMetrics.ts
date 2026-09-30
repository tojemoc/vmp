/**
 * PostHog application metrics for the API Worker (`posthog-node` metrics API).
 *
 * Samples aggregate in memory and flush via `flushPostHogMetrics` at the end of
 * each Worker invocation (`runWithDatadogLogContext`). Opt out with
 * `POSTHOG_METRICS_ENABLED=false`.
 *
 * @see https://posthog.com/docs/metrics
 */
import {
  getSharedPostHogClient,
  type PostHogWaitUntilCtx,
  resolvePostHogProjectToken,
  resolvePostHogServiceName,
} from './posthog.js';

export type PostHogMetricAttributes = Record<string, string | number | boolean>;

export type CapturePostHogMetricOptions = {
  unit?: string;
  attributes?: PostHogMetricAttributes;
};

export { resolvePostHogServiceName as resolvePostHogMetricsServiceName };

/** Enabled when a project token is set; opt out with POSTHOG_METRICS_ENABLED=false. */
export function isPostHogMetricsEnabled(env: Record<string, unknown>): boolean {
  if (!resolvePostHogProjectToken(env)) return false;
  const flag = String(env.POSTHOG_METRICS_ENABLED ?? '')
    .trim()
    .toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  return true;
}

/** Increment a monotonic counter (safe on hot paths; flushed once per invocation). */
export function recordPostHogCount(
  env: Record<string, unknown> | undefined,
  name: string,
  value = 1,
  options: CapturePostHogMetricOptions = {},
): void {
  if (!env || !isPostHogMetricsEnabled(env)) return;
  const metricName = name.trim();
  if (!metricName || !Number.isFinite(value) || value < 0) return;
  try {
    const client = getSharedPostHogClient(env);
    client?.metrics.count(metricName, value, options);
  } catch (err) {
    console.error('[posthog] metrics.count failed', err);
  }
}

/** Record a gauge sample. */
export function recordPostHogGauge(
  env: Record<string, unknown> | undefined,
  name: string,
  value: number,
  options: CapturePostHogMetricOptions = {},
): void {
  if (!env || !isPostHogMetricsEnabled(env)) return;
  const metricName = name.trim();
  if (!metricName || !Number.isFinite(value)) return;
  try {
    const client = getSharedPostHogClient(env);
    client?.metrics.gauge(metricName, value, options);
  } catch (err) {
    console.error('[posthog] metrics.gauge failed', err);
  }
}

/** Record a histogram observation (e.g. latency in ms). */
export function recordPostHogHistogram(
  env: Record<string, unknown> | undefined,
  name: string,
  value: number,
  options: CapturePostHogMetricOptions = {},
): void {
  if (!env || !isPostHogMetricsEnabled(env)) return;
  const metricName = name.trim();
  if (!metricName || !Number.isFinite(value)) return;
  try {
    const client = getSharedPostHogClient(env);
    client?.metrics.histogram(metricName, value, options);
  } catch (err) {
    console.error('[posthog] metrics.histogram failed', err);
  }
}

/**
 * HTTP methods allowed as metric label values. Anything else becomes OTHER so
 * arbitrary client-supplied method tokens cannot create unbounded series.
 */
const HTTP_METRIC_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Normalize a request method for metric attributes (unknown → OTHER). */
export function normalizeHttpMetricMethod(method: string | undefined): string {
  const normalized = String(method || '')
    .trim()
    .toUpperCase();
  if (HTTP_METRIC_METHODS.has(normalized)) return normalized;
  return 'OTHER';
}

/**
 * HTTP server request metrics — low-cardinality attributes only
 * (method, route template, status). Never attach user IDs.
 */
export function recordHttpServerRequestMetric(
  env: Record<string, unknown> | undefined,
  input: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
  },
): void {
  if (!env || !isPostHogMetricsEnabled(env)) return;

  const method = normalizeHttpMetricMethod(input.method);
  const route = String(input.route || '/').trim() || '/';
  const status = Number.isFinite(input.status) ? Math.trunc(input.status) : 0;
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;
  const attributes: PostHogMetricAttributes = {
    'http.request.method': method,
    'http.route': route,
    'http.response.status_code': String(status),
  };

  recordPostHogCount(env, 'http.server.request.count', 1, { attributes });
  recordPostHogHistogram(env, 'http.server.request.duration', durationMs, {
    unit: 'ms',
    attributes,
  });
}

/** Flush aggregated metrics (call via waitUntil at end of Worker invocation). */
export async function flushPostHogMetrics(env: Record<string, unknown>): Promise<void> {
  if (!isPostHogMetricsEnabled(env)) return;
  const client = getSharedPostHogClient(env);
  if (!client) return;
  await client.metrics.flush();
}

/** Schedule a metrics flush on the ExecutionContext when available. */
export function schedulePostHogMetricsFlush(
  env: Record<string, unknown>,
  ctx?: PostHogWaitUntilCtx,
): Promise<void> | void {
  if (!isPostHogMetricsEnabled(env)) return;
  const promise = flushPostHogMetrics(env).catch((err) => {
    console.error('[posthog] metrics flush failed', err);
  });
  if (typeof ctx?.waitUntil === 'function') {
    ctx.waitUntil(promise);
    return;
  }
  return promise;
}
