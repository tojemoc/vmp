import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isWebDeploymentFeatureCompiled,
  resolveWebDeploymentFeatures,
} from '../utils/resolveDeploymentFeatures';

describe('resolveWebDeploymentFeatures', () => {
  it('marks modular plugins compiled when plugin files exist (A1 always-register)', () => {
    const features = resolveWebDeploymentFeatures();
    assert.equal(features.gtm.requested, true);
    assert.equal(features.gtm.pluginPresent, true);
    assert.equal(features.gtm.compiled, true);
    assert.equal(isWebDeploymentFeatureCompiled(features, 'gtm'), true);
    assert.equal(features.posthog.compiled, true);
    assert.equal(features.pwa.compiled, true);
  });

  it('marks non-modular catalog ids compiled (no plugin path required)', () => {
    const features = resolveWebDeploymentFeatures();
    assert.equal(features.payments.pluginPresent, true);
    assert.equal(features.payments.compiled, true);
  });
});
