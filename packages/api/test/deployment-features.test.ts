import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInfraFeatureManifest,
  createStaticFlagshipBinding,
  isInfraFeatureEnabled,
} from '../src/infraFlags.js';
import { maybeBlockDeploymentFeatureRoute } from '../src/routeFeatureGuard.js';

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

  it('fails closed when FLAGS unbound', async () => {
    assert.equal(await isInfraFeatureEnabled({}, 'cms'), false);
    assert.equal(await isInfraFeatureEnabled({}, 'payments'), false);
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

  it('never blocks deployment-features routes', async () => {
    for (const path of ['/api/admin/deployment-features', '/api/deployment-features']) {
      const res = await maybeBlockDeploymentFeatureRoute(
        new Request(`https://example.com${path}`, { method: 'GET' }),
        { FLAGS: createStaticFlagshipBinding(['payments']) },
        {},
      );
      assert.equal(res, null);
    }
  });

  it('fails closed when FLAGS unbound', async () => {
    const blocked = await maybeBlockDeploymentFeatureRoute(
      new Request('https://example.com/api/pills', { method: 'GET' }),
      {},
      {},
    );
    assert.equal(blocked?.status, 404);
  });
});
