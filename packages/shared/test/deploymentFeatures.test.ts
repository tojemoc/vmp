import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_DEPLOYMENT_FEATURES,
  DEPLOYMENT_FEATURE_IDS,
  parseFeatureAllowlistCsv,
  parseDeploymentFeaturesEnv,
} from '../src/deploymentFeatures.js';

describe('deploymentFeatures', () => {
  it('parseFeatureAllowlistCsv returns empty for unset (fail closed)', () => {
    assert.equal(parseFeatureAllowlistCsv(undefined).size, 0);
    assert.equal(parseFeatureAllowlistCsv('').size, 0);
  });

  it('parseFeatureAllowlistCsv parses comma-separated allowlist', () => {
    const features = parseFeatureAllowlistCsv('gtm, posthog, pwa');
    assert.equal(features.has('gtm'), true);
    assert.equal(features.has('posthog'), true);
    assert.equal(features.has('pwa'), true);
    assert.equal(features.has('newsletter'), false);
  });

  it('normalizes hyphenated tokens', () => {
    const features = parseFeatureAllowlistCsv('legacy-migration,rss-podcast');
    assert.equal(features.has('legacy_migration'), true);
    assert.equal(features.has('rss_podcast'), true);
  });

  it('ignores unknown tokens', () => {
    const features = parseFeatureAllowlistCsv('gtm,unknown-feature');
    assert.equal(features.size, 1);
    assert.equal(features.has('gtm'), true);
  });

  it('parseDeploymentFeaturesEnv reads FLAGSHIP_DEV_OVERRIDE only', () => {
    assert.equal(parseDeploymentFeaturesEnv({}).size, 0);
    assert.equal(parseDeploymentFeaturesEnv({ VMP_FEATURES: 'gtm,posthog' }).size, 0);
    const fromOverride = parseDeploymentFeaturesEnv({ FLAGSHIP_DEV_OVERRIDE: 'cms,pills' });
    assert.equal(fromOverride.has('cms'), true);
    assert.equal(fromOverride.has('pills'), true);
  });

  it('DEFAULT_DEPLOYMENT_FEATURES covers the catalog', () => {
    assert.equal(DEFAULT_DEPLOYMENT_FEATURES.length, DEPLOYMENT_FEATURE_IDS.length);
  });
});
