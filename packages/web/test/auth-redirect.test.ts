import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveAuthReturnPath, safeRedirectPath } from '../utils/authRedirect';

describe('safeRedirectPath', () => {
  it('accepts same-origin paths', () => {
    assert.equal(safeRedirectPath('/watch/abc', '/'), '/watch/abc');
    assert.equal(safeRedirectPath('/account?tab=1', '/'), '/account?tab=1');
  });

  it('rejects open redirects', () => {
    assert.equal(safeRedirectPath('https://evil.example/', '/'), '/');
    assert.equal(safeRedirectPath('//evil.example/', '/'), '/');
    assert.equal(safeRedirectPath('', '/'), '/');
  });
});

describe('resolveAuthReturnPath', () => {
  it('prefers explicit redirect', () => {
    assert.equal(resolveAuthReturnPath('/account', '/watch/1'), '/account');
  });

  it('falls back to current path when not an auth page', () => {
    assert.equal(resolveAuthReturnPath(undefined, '/watch/vid?showPremium=1'), '/watch/vid?showPremium=1');
    assert.equal(resolveAuthReturnPath(undefined, '/blog/slug'), '/blog/slug');
  });

  it('does not bounce back onto login or auth intermediates', () => {
    assert.equal(resolveAuthReturnPath(undefined, '/login'), undefined);
    assert.equal(resolveAuthReturnPath(undefined, '/login?x=1'), undefined);
    assert.equal(resolveAuthReturnPath(undefined, '/auth/verify?token=x'), undefined);
    assert.equal(resolveAuthReturnPath(undefined, '/auth/2fa'), undefined);
  });
});
