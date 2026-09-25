import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { capturePostHogEvent } from '../utils/posthogClient';
import { canCapturePostHogAnalytics, POSTHOG_ANALYTICS_CONSENT_KEY } from '../utils/posthogConsent';

type WindowWithPostHog = {
  posthog?: {
    capture: (event: string, properties?: Record<string, unknown>) => unknown;
    is_capturing?: () => boolean;
  };
};

function setWindow(next: WindowWithPostHog | undefined): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: next,
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
  });

  afterEach(() => {
    setWindow(undefined);
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
    setWindow({
      posthog: {
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
      },
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => (key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'granted' : null),
        setItem: () => {},
      },
    });

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
