import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isWebDeploymentFeatureCompiled,
  resolveWebDeploymentFeatures,
} from '../utils/resolveDeploymentFeatures';

describe('resolveWebDeploymentFeatures', () => {
  it('compiles gtm when requested and plugin file exists', () => {
    const features = resolveWebDeploymentFeatures({ VMP_FEATURES: 'gtm' });
    assert.equal(features.gtm.requested, true);
    assert.equal(features.gtm.pluginPresent, true);
    assert.equal(features.gtm.compiled, true);
    assert.equal(isWebDeploymentFeatureCompiled(features, 'gtm'), true);
  });

  it('does not compile gtm when omitted from allowlist', () => {
    const features = resolveWebDeploymentFeatures({ VMP_FEATURES: 'posthog,pwa' });
    assert.equal(features.gtm.requested, false);
    assert.equal(features.gtm.compiled, false);
  });

  it('does not compile posthog when omitted even with a project token env present', () => {
    const features = resolveWebDeploymentFeatures({ VMP_FEATURES: 'gtm' });
    assert.equal(features.posthog.compiled, false);
  });
});
