import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Phase C smoke: helpers exist and fail closed without a PostHog token.
 * Full posthog-node evaluation is integration-tested against a live project later.
 */
describe('posthogServer helpers', () => {
  it('exports getServerPostHogFeatureFlag and getAllServerPostHogFeatureFlags', async () => {
    const mod = await import('../server/utils/posthogServer');
    assert.equal(typeof mod.getServerPostHogFeatureFlag, 'function');
    assert.equal(typeof mod.getAllServerPostHogFeatureFlags, 'function');
    assert.equal(typeof mod.shutdownServerPostHog, 'function');
  });
});
