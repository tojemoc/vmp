import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { canCapturePostHogAnalytics, POSTHOG_ANALYTICS_CONSENT_KEY } from '../utils/posthogConsent';
import { capturePostHogEvent } from '../utils/posthogClient';

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

  it('capturePostHogEvent forwards events to window.posthog after consent', () => {
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

    assert.deepEqual(captured, [
      {
        event: 'subscription_checkout_started',
        properties: {
          $environment: 'development',
          plan_type: 'monthly',
          provider: 'stripe',
        },
      },
    ]);
  });

  it('capturePostHogEvent does not forward product events when consent is denied', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setWindow({
      posthog: {
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
        is_capturing: () => true,
      },
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) =>
          key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'denied' : null,
        setItem: () => {},
      },
    });

    capturePostHogEvent('magic_link_requested');

    assert.deepEqual(captured, []);
    assert.equal(canCapturePostHogAnalytics(), false);
  });

  it('capturePostHogEvent does not forward events when consent is undecided', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setWindow({
      posthog: {
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
        is_capturing: () => true,
      },
    });

    capturePostHogEvent('magic_link_requested');

    assert.deepEqual(captured, []);
    assert.equal(canCapturePostHogAnalytics(), false);
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
