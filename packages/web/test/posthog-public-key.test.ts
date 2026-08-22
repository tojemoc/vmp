import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isPostHogConfigured,
  resolvePostHogPublicKeyFromEnv,
  resolvePostHogPublicKeyFromRuntimeConfig,
} from '../utils/posthogPublicKey';

describe('posthogPublicKey', () => {
  it('resolvePostHogPublicKeyFromEnv prefers NUXT_PUBLIC_POSTHOG_KEY', () => {
    const key = resolvePostHogPublicKeyFromEnv({
      NUXT_PUBLIC_POSTHOG_KEY: ' phc_primary ',
      NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_fallback',
      NUXT_PUBLIC_POSTHOG_PUBLIC_KEY: 'phc_nested',
    });

    assert.equal(key, 'phc_primary');
  });

  it('resolvePostHogPublicKeyFromEnv falls back to NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN', () => {
    const key = resolvePostHogPublicKeyFromEnv({
      NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_from_project_token',
    });

    assert.equal(key, 'phc_from_project_token');
  });

  it('resolvePostHogPublicKeyFromEnv accepts NUXT_PUBLIC_POSTHOG_PUBLIC_KEY', () => {
    const key = resolvePostHogPublicKeyFromEnv({
      NUXT_PUBLIC_POSTHOG_PUBLIC_KEY: 'phc_nested_override',
    });

    assert.equal(key, 'phc_nested_override');
  });

  it('resolvePostHogPublicKeyFromRuntimeConfig reads public.posthog.publicKey', () => {
    const key = resolvePostHogPublicKeyFromRuntimeConfig({
      public: { posthog: { publicKey: ' phc_runtime ' } },
    });

    assert.equal(key, 'phc_runtime');
  });

  it('isPostHogConfigured is false without a token', () => {
    assert.equal(isPostHogConfigured({ public: { posthog: { publicKey: '' } } }), false);
    assert.equal(isPostHogConfigured({ public: {} }), false);
  });

  it('isPostHogConfigured is true when publicKey is set', () => {
    assert.equal(
      isPostHogConfigured({ public: { posthog: { publicKey: 'phc_ok' } } }),
      true,
    );
  });
});
