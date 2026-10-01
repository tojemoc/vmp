import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDeploymentFeatureManifest,
  isDeploymentFeatureCompiled,
} from '../src/deploymentFeatures.js';
import {
  buildInfraFeatureManifest,
  createStaticFlagshipBinding,
  isInfraFeatureEnabled,
} from '../src/infraFlags.js';
import { maybeBlockDeploymentFeatureRoute } from '../src/routeFeatureGuard.js';

describe('deploymentFeatures (API) — VMP_FEATURES fallback', () => {
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

describe('infraFlags (Flagship)', () => {
  it('uses Flagship binding with code default false', async () => {
    const env = {
      FLAGS: createStaticFlagshipBinding(['payments', 'posthog']),
    };
    assert.equal(await isInfraFeatureEnabled(env, 'payments'), true);
    assert.equal(await isInfraFeatureEnabled(env, 'gtm'), false);
  });

  it('FLAGSHIP_DEV_OVERRIDE wins over Flagship binding', async () => {
    const env = {
      FLAGS: createStaticFlagshipBinding(['payments']),
      FLAGSHIP_DEV_OVERRIDE: 'pills',
    };
    assert.equal(await isInfraFeatureEnabled(env, 'pills'), true);
    assert.equal(await isInfraFeatureEnabled(env, 'payments'), false);
  });

  it('falls back to VMP_FEATURES when FLAGS unbound', async () => {
    const env = { VMP_FEATURES: 'cms' };
    assert.equal(await isInfraFeatureEnabled(env, 'cms'), true);
    assert.equal(await isInfraFeatureEnabled(env, 'payments'), false);
  });

  it('buildInfraFeatureManifest uses evaluator', async () => {
    const manifest = await buildInfraFeatureManifest({
      FLAGS: createStaticFlagshipBinding(['pills']),
    });
    assert.equal(manifest.pills.compiled, true);
    assert.equal(manifest.newsletter.compiled, false);
  });
});

describe('routeFeatureGuard', () => {
  it('blocks pills routes when pills not enabled', async () => {
    const res = await maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      { FLAGS: createStaticFlagshipBinding(['payments']) },
      {},
    );
    assert.ok(res);
    assert.equal(res?.status, 404);
  });

  it('allows pills when Flagship enabled', async () => {
    const res = await maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      { FLAGS: createStaticFlagshipBinding(['pills']) },
      {},
    );
    assert.equal(res, null);
  });

  it('never blocks deployment-features introspection route', async () => {
    const res = await maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/admin/deployment-features', { method: 'GET' }),
      { FLAGS: createStaticFlagshipBinding(['payments']) },
      {},
    );
    assert.equal(res, null);
  });

  it('falls back to VMP_FEATURES when FLAGS unbound', async () => {
    const blocked = await maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      { VMP_FEATURES: 'payments' },
      {},
    );
    assert.equal(blocked?.status, 404);

    const allowed = await maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      { VMP_FEATURES: 'pills' },
      {},
    );
    assert.equal(allowed, null);
  });
});
