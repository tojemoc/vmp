import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstSearchParam, safeRedirectPath, tokenFromAuthUrl } from '../src/auth/deepLink';

describe('mobile deepLink helpers', () => {
  it('safeRedirectPath accepts same-app paths only', () => {
    assert.equal(safeRedirectPath('/watch/1'), '/watch/1');
    assert.equal(safeRedirectPath('/'), '/');
    assert.equal(safeRedirectPath('//evil.com'), '/');
    assert.equal(safeRedirectPath('https://evil.com'), '/');
    assert.equal(safeRedirectPath('../x'), '/');
    assert.equal(safeRedirectPath(undefined, '/login'), '/login');
  });

  it('firstSearchParam unwraps Expo Router arrays', () => {
    assert.equal(firstSearchParam('abc'), 'abc');
    assert.equal(firstSearchParam(['tok', 'other']), 'tok');
    assert.equal(firstSearchParam(undefined), '');
  });

  it('tokenFromAuthUrl reads https App Link tokens', () => {
    assert.equal(
      tokenFromAuthUrl('https://vmp.example/auth/verify?token=abc%2B123&redirect=%2F', false),
      'abc+123',
    );
  });

  it('tokenFromAuthUrl gates vmp:// on allowCustomScheme', () => {
    assert.equal(tokenFromAuthUrl('vmp://auth/verify?token=secret', false), null);
    assert.equal(tokenFromAuthUrl('vmp://auth/verify?token=secret', true), 'secret');
  });
});
