import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { capturePostHogEvent } from '../utils/posthogClient';

type WindowWithPostHog = {
  posthog?: { capture: (event: string, properties?: Record<string, unknown>) => unknown };
};

function setWindow(next: WindowWithPostHog | undefined): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: next,
  });
}

describe('posthogClient', () => {
  afterEach(() => {
    setWindow(undefined);
  });

  it('capturePostHogEvent is a no-op without a PostHog client', () => {
    assert.doesNotThrow(() => {
      capturePostHogEvent('magic_link_requested');
    });
  });

  it('capturePostHogEvent forwards events to window.posthog', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setWindow({
      posthog: {
        capture: (event, properties) => {
          captured.push({ event, properties: properties ?? {} });
        },
      },
    });

    capturePostHogEvent('subscription_checkout_started', {
      plan_type: 'monthly',
      provider: 'stripe',
    });

    assert.deepEqual(captured, [
      {
        event: 'subscription_checkout_started',
        properties: { plan_type: 'monthly', provider: 'stripe' },
      },
    ]);
  });
});
