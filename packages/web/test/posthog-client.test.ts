import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  capturePostHogEvent,
  getPostHogClient,
  setPostHogClient,
} from '../utils/posthogClient';

describe('posthogClient', () => {
  it('capturePostHogEvent is a no-op without an initialized client', () => {
    setPostHogClient(null);
    assert.doesNotThrow(() => {
      capturePostHogEvent('magic_link_requested');
    });
    assert.equal(getPostHogClient(), null);
  });

  it('capturePostHogEvent forwards events to the shared client', () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setPostHogClient({
      capture: (event: string, properties?: Record<string, unknown>) => {
        captured.push({ event, properties: properties ?? {} });
      },
    } as never);

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
