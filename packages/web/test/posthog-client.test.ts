import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  approvedMetricAttributes,
  capturePostHogEvent,
  recordPostHogCount,
} from '../utils/posthogClient';
import { canCapturePostHogAnalytics, POSTHOG_ANALYTICS_CONSENT_KEY } from '../utils/posthogConsent';

type PostHogCaptureFn = (event: string, properties?: Record<string, unknown>) => unknown;

type WindowWithPostHog = {
  posthog?: {
    capture: PostHogCaptureFn;
    is_capturing?: () => boolean;
    metrics?: {
      count: (name: string, value?: number, options?: unknown) => void;
    };
  };
};

type GlobalWithUseNuxtApp = typeof globalThis & {
  useNuxtApp?: () => {
    $posthog?: () => {
      capture: PostHogCaptureFn;
      metrics?: { count: (name: string, value?: number, options?: unknown) => void };
    };
  };
};

function setWindow(next: WindowWithPostHog | undefined): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: next,
  });
}

function grantAnalyticsConsent(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => (key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'granted' : null),
      setItem: () => {},
    },
  });
}

describe('posthogClient', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: () => null,
        setItem: () => {},
      },
    });
    delete (globalThis as GlobalWithUseNuxtApp).useNuxtApp;
  });

  afterEach(() => {
    setWindow(undefined);
    delete (globalThis as GlobalWithUseNuxtApp).useNuxtApp;
  });

  it('approvedMetricAttributes keep only allowlisted keys and values', () => {
    assert.deepEqual(
      approvedMetricAttributes({
        plan_type: 'monthly',
        provider: 'stripe',
        client: 'browser',
        surface: 'checkout',
        rendition: '720p',
        reason: 'verify_error',
        optedOut: true,
        video_id: 'v1',
        nested: { a: 1 },
      }),
      {
        plan_type: 'monthly',
        provider: 'stripe',
        client: 'browser',
        surface: 'checkout',
        rendition: '720p',
        reason: 'verify_error',
        optedOut: true,
      },
    );
    assert.deepEqual(
      approvedMetricAttributes({
        plan_type: 'lifetime',
        provider: 'paypal',
        surface: 'unknown_surface',
        rendition: '4k',
      }),
      {},
    );
  });

  it('capturePostHogEvent is a no-op without a PostHog client', () => {
    assert.doesNotThrow(() => {
      capturePostHogEvent('magic_link_requested');
    });
  });

  it('capturePostHogEvent is a no-op without analytics consent', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setWindow({
      posthog: {
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
      },
    });

    capturePostHogEvent('magic_link_requested');

    assert.deepEqual(captured, []);
  });

  it('capturePostHogEvent forwards events via getBrowserPostHog after consent', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const metricCounts: Array<{ name: string; value: number; options?: unknown }> = [];
    setWindow({
      posthog: {
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
        metrics: {
          count: (name, value, options) => {
            metricCounts.push({ name, value: value ?? 1, options });
          },
        },
      },
    });
    grantAnalyticsConsent();

    capturePostHogEvent('subscription_checkout_started', {
      plan_type: 'monthly',
      provider: 'stripe',
    });
    capturePostHogEvent('subscription_checkout_completed', { provider: 'stripe' });
    capturePostHogEvent('offline_download_requested', { video_id: 'v1', rendition: '720p' });
    capturePostHogEvent('billing_portal_opened');
    capturePostHogEvent('magic_link_requested', { client: 'browser' });

    assert.deepEqual(
      captured.map((row) => row.event),
      [
        'subscription_checkout_started',
        'subscription_checkout_completed',
        'offline_download_requested',
        'billing_portal_opened',
        'magic_link_requested',
      ],
    );
    assert.deepEqual(captured[0]?.properties, {
      $environment: 'development',
      plan_type: 'monthly',
      provider: 'stripe',
    });
    assert.deepEqual(
      metricCounts.map((row) => row.name),
      [
        'subscription_checkout_started',
        'subscription_checkout_completed',
        'offline_download_requested',
        'billing_portal_opened',
        'magic_link_requested',
      ],
    );
    assert.deepEqual(metricCounts[0]?.options, {
      attributes: { plan_type: 'monthly', provider: 'stripe' },
    });
    // video_id is not an approved metric dimension — only rendition remains.
    assert.deepEqual(metricCounts[2]?.options, {
      attributes: { rendition: '720p' },
    });
  });

  it('capturePostHogEvent forwards via $posthog when window.posthog is unset', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    // Production path: `@posthog/nuxt` provides `$posthog` and does not set window.posthog.
    setWindow({});
    (globalThis as GlobalWithUseNuxtApp).useNuxtApp = () => ({
      $posthog: () => ({
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
      }),
    });
    grantAnalyticsConsent();

    capturePostHogEvent('subscription_checkout_started', {
      plan_type: 'yearly',
      provider: 'stripe',
    });

    assert.deepEqual(captured, [
      {
        event: 'subscription_checkout_started',
        properties: {
          $environment: 'development',
          plan_type: 'yearly',
          provider: 'stripe',
        },
      },
    ]);
  });

  it('capturePostHogEvent does not forward events without granted consent', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const posthog = {
      capture: (event: string, properties?: Record<string, unknown>) => {
        captured.push({ event, properties: properties ?? {} });
      },
      is_capturing: () => true,
    };

    for (const consent of ['denied', null] as const) {
      captured.length = 0;
      setWindow({ posthog });
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: {
          getItem: (key: string) =>
            consent !== null && key === POSTHOG_ANALYTICS_CONSENT_KEY ? consent : null,
          setItem: () => {},
        },
      });

      capturePostHogEvent('magic_link_requested');

      assert.deepEqual(captured, [], `expected no capture when consent is ${String(consent)}`);
      assert.equal(canCapturePostHogAnalytics(), false);
    }
  });

  it('recordPostHogCount is a no-op without consent', () => {
    const metricCounts: string[] = [];
    setWindow({
      posthog: {
        capture: () => {},
        metrics: {
          count: (name) => {
            metricCounts.push(name);
          },
        },
      },
    });
    recordPostHogCount('checkout.completed');
    assert.deepEqual(metricCounts, []);
  });

  it('capturePostHogEvent swallows client capture errors', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => (key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'granted' : null),
        setItem: () => {},
      },
    });
    setWindow({
      posthog: {
        capture: () => {
          throw new Error('posthog down');
        },
      },
    });
    assert.doesNotThrow(() => {
      capturePostHogEvent('magic_link_requested');
    });
  });
});
