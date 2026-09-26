import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMagicLinkClient } from '@vmp/shared';

/**
 * Mirrors packages/web/utils/magicLinkClient.ts without Nuxt/PWA imports —
 * documents that OTP / login / header / native all share one client enum.
 */
function resolveMagicLinkClientForSurface(
  override: unknown,
  isPwa: boolean,
): ReturnType<typeof normalizeMagicLinkClient> {
  if (override != null && override !== '') {
    return normalizeMagicLinkClient(override);
  }
  return isPwa ? 'pwa' : 'browser';
}

describe('magic-link client stamp (shared across OTP surfaces)', () => {
  it('honors explicit native / pwa / browser', () => {
    assert.equal(resolveMagicLinkClientForSurface('native', false), 'native');
    assert.equal(resolveMagicLinkClientForSurface('pwa', false), 'pwa');
    assert.equal(resolveMagicLinkClientForSurface('browser', true), 'browser');
  });

  it('defaults from installed-PWA detection when unset', () => {
    assert.equal(resolveMagicLinkClientForSurface(undefined, true), 'pwa');
    assert.equal(resolveMagicLinkClientForSurface(undefined, false), 'browser');
  });
});
