import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  createPostHogClient,
  getSharedPostHogClient,
  resetPostHogClientForTests,
} from '../src/posthog.js';
import {
  flushPostHogMetrics,
  isPostHogMetricsEnabled,
  normalizeHttpMetricMethod,
  recordHttpServerRequestMetric,
  recordPostHogCount,
  recordPostHogGauge,
  recordPostHogHistogram,
  resolvePostHogMetricsServiceName,
} from '../src/posthogMetrics.js';

describe('PostHog application metrics', () => {
  afterEach(() => {
    resetPostHogClientForTests();
  });

  it('normalizeHttpMetricMethod allowlists known methods and maps others to OTHER', () => {
    assert.equal(normalizeHttpMetricMethod('get'), 'GET');
    assert.equal(normalizeHttpMetricMethod('POST'), 'POST');
    assert.equal(normalizeHttpMetricMethod('patch'), 'PATCH');
    assert.equal(normalizeHttpMetricMethod('OPTIONS'), 'OPTIONS');
    assert.equal(normalizeHttpMetricMethod('TRACE'), 'OTHER');
    assert.equal(normalizeHttpMetricMethod('PROPFIND'), 'OTHER');
    assert.equal(normalizeHttpMetricMethod(''), 'OTHER');
    assert.equal(normalizeHttpMetricMethod(undefined), 'OTHER');
  });
  it('isPostHogMetricsEnabled requires project token and allows opt-out', () => {
    assert.equal(isPostHogMetricsEnabled({}), false);
    assert.equal(isPostHogMetricsEnabled({ POSTHOG_PROJECT_TOKEN: 'phc_test' }), true);
    assert.equal(
      isPostHogMetricsEnabled({
        POSTHOG_PROJECT_TOKEN: 'phc_test',
        POSTHOG_METRICS_ENABLED: 'false',
      }),
      false,
    );
    assert.equal(
      isPostHogMetricsEnabled({
        POSTHOG_PROJECT_TOKEN: 'phc_test',
        POSTHOG_METRICS_ENABLED: 'true',
      }),
      true,
    );
  });

  it('resolvePostHogMetricsServiceName prefers POSTHOG_METRICS_SERVICE then DD_SERVICE', () => {
    assert.equal(resolvePostHogMetricsServiceName({}), 'vmp-api');
    assert.equal(resolvePostHogMetricsServiceName({ DD_SERVICE: 'api-dd' }), 'api-dd');
    assert.equal(
      resolvePostHogMetricsServiceName({
        DD_SERVICE: 'api-dd',
        POSTHOG_METRICS_SERVICE: 'vmp-api-custom',
      }),
      'vmp-api-custom',
    );
  });

  it('createPostHogClient exposes the metrics API', () => {
    const client = createPostHogClient({
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      POSTHOG_METRICS_SERVICE: 'vmp-api',
      SENTRY_ENVIRONMENT: 'staging',
    });
    assert.ok(client);
    if (!client) return;
    assert.equal(typeof client.metrics.count, 'function');
    assert.equal(typeof client.metrics.histogram, 'function');
    assert.equal(typeof client.metrics.flush, 'function');
  });

  it('recordHttpServerRequestMetric + flush posts an OTLP metrics payload', async () => {
    const env = {
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      POSTHOG_HOST: 'https://eu.i.posthog.com',
      POSTHOG_METRICS_SERVICE: 'vmp-api',
      SENTRY_ENVIRONMENT: 'staging',
    };

    // Warm the shared client used by record helpers.
    assert.ok(getSharedPostHogClient(env));

    recordHttpServerRequestMetric(env, {
      method: 'get',
      route: '/api/videos',
      status: 200,
      durationMs: 12.5,
    });
    recordPostHogCount(env, 'jobs.processed', 1, { attributes: { queue: 'default' } });
    recordPostHogGauge(env, 'queue.depth', 3, { attributes: { queue: 'default' } });
    recordPostHogHistogram(env, 'job.duration', 42, { unit: 'ms' });

    // Opt-out must not throw.
    recordHttpServerRequestMetric(
      { POSTHOG_PROJECT_TOKEN: 'phc_test', POSTHOG_METRICS_ENABLED: 'false' },
      { method: 'GET', route: '/api/videos', status: 200, durationMs: 1 },
    );

    const originalFetch = globalThis.fetch;
    const metricUrls: string[] = [];
    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/i/v1/metrics')) {
        assert.equal(init?.method, 'POST');
        metricUrls.push(url);
        // Body may be gzip-compressed OTLP; presence of the POST is enough here.
        assert.ok(init?.body != null);
        return new Response(null, { status: 200 });
      }
      // Event capture / other PostHog routes — acknowledge without failing the test.
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      await flushPostHogMetrics(env);
      assert.ok(metricUrls.length >= 1, 'expected at least one metrics upload');
      assert.match(metricUrls[0] ?? '', /\/i\/v1\/metrics/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('flushPostHogMetrics is a no-op without token or when opted out', async () => {
    await assert.doesNotReject(() => flushPostHogMetrics({}));
    await assert.doesNotReject(() =>
      flushPostHogMetrics({ POSTHOG_PROJECT_TOKEN: 'phc_test', POSTHOG_METRICS_ENABLED: '0' }),
    );
  });
});
