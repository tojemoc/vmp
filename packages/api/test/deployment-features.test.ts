import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDeploymentFeatureManifest,
  isDeploymentFeatureCompiled,
} from '../src/deploymentFeatures.js';
import { maybeBlockDeploymentFeatureRoute } from '../src/routeFeatureGuard.js';

describe('deploymentFeatures (API)', () => {
  it('defaults to all features when VMP_FEATURES unset', () => {
    assert.equal(isDeploymentFeatureCompiled({}, 'gtm'), true);
    assert.equal(isDeploymentFeatureCompiled({}, 'payments'), true);
  });

  it('honors allowlist', () => {
    const env = { VMP_FEATURES: 'posthog,payments' };
    assert.equal(isDeploymentFeatureCompiled(env, 'payments'), true);
    assert.equal(isDeploymentFeatureCompiled(env, 'gtm'), false);
  });

  it('buildDeploymentFeatureManifest marks compiled flags', () => {
    const manifest = buildDeploymentFeatureManifest({ VMP_FEATURES: 'pills' });
    assert.equal(manifest.pills.compiled, true);
    assert.equal(manifest.newsletter.compiled, false);
  });
});

describe('routeFeatureGuard', () => {
  it('blocks pills routes when pills not compiled', () => {
    const res = maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      { VMP_FEATURES: 'payments' },
      {},
    );
    assert.ok(res);
    assert.equal(res?.status, 404);
  });

  it('allows pills when compiled', () => {
    const res = maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      { VMP_FEATURES: 'pills' },
      {},
    );
    assert.equal(res, null);
  });

  it('never blocks deployment-features introspection route', () => {
    const res = maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/admin/deployment-features', { method: 'GET' }),
      { VMP_FEATURES: 'payments' },
      {},
    );
    assert.equal(res, null);
  });
});
