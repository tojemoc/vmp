import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_DEPLOYMENT_FEATURES,
  DEPLOYMENT_FEATURE_IDS,
  parseDeploymentFeaturesEnv,
} from '../src/deploymentFeatures.js';

describe('deploymentFeatures', () => {
  it('defaults to all features when VMP_FEATURES is unset', () => {
    const features = parseDeploymentFeaturesEnv({});
    assert.equal(features.size, DEPLOYMENT_FEATURE_IDS.length);
    for (const id of DEFAULT_DEPLOYMENT_FEATURES) {
      assert.equal(features.has(id), true, id);
    }
  });

  it('parses comma-separated allowlist', () => {
    const features = parseDeploymentFeaturesEnv({ VMP_FEATURES: 'gtm, posthog, pwa' });
    assert.equal(features.has('gtm'), true);
    assert.equal(features.has('posthog'), true);
    assert.equal(features.has('pwa'), true);
    assert.equal(features.has('newsletter'), false);
  });

  it('normalizes hyphenated tokens', () => {
    const features = parseDeploymentFeaturesEnv({ VMP_FEATURES: 'legacy-migration,rss-podcast' });
    assert.equal(features.has('legacy_migration'), true);
    assert.equal(features.has('rss_podcast'), true);
  });

  it('ignores unknown tokens', () => {
    const features = parseDeploymentFeaturesEnv({ VMP_FEATURES: 'gtm,unknown-feature' });
    assert.equal(features.size, 1);
    assert.equal(features.has('gtm'), true);
  });
});
