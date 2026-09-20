import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAndroidNativeAppIntentUrl,
  DEFAULT_MOBILE_ANDROID_PACKAGE,
  isNativeAppFallbackQuery,
  resolveMobileAndroidPackage,
  withNativeAppFallbackParam,
} from '../utils/nativeAppHandoff';

describe('nativeAppHandoff', () => {
  it('detects native_fallback query values', () => {
    assert.equal(isNativeAppFallbackQuery('1'), true);
    assert.equal(isNativeAppFallbackQuery('true'), true);
    assert.equal(isNativeAppFallbackQuery(['1']), true);
    assert.equal(isNativeAppFallbackQuery('0'), false);
    assert.equal(isNativeAppFallbackQuery(undefined), false);
  });

  it('adds native_fallback=1 without dropping the magic-link token', () => {
    const next = withNativeAppFallbackParam(
      'https://vmp.example/auth/verify?token=abc%2B123&redirect=%2Fwatch%2F1',
    );
    const url = new URL(next);
    assert.equal(url.searchParams.get('token'), 'abc+123');
    assert.equal(url.searchParams.get('redirect'), '/watch/1');
    assert.equal(url.searchParams.get('native_fallback'), '1');
  });

  it('builds a package-targeted https intent URL with browser fallback', () => {
    const intent = buildAndroidNativeAppIntentUrl(
      'https://vmp.example/auth/verify?token=raw-token&client=native',
      'sk.tjm.vmp',
    );
    assert.match(
      intent,
      /^intent:\/\/vmp\.example\/auth\/verify\?token=raw-token&client=native#Intent;/,
    );
    assert.match(intent, /;scheme=https;/);
    assert.match(intent, /;package=sk\.tjm\.vmp;/);
    assert.match(intent, /S\.browser_fallback_url=/);
    assert.match(intent, /native_fallback%3D1/);
    assert.match(intent, /;end$/);
  });

  it('falls back to the default package for empty or unsafe names', () => {
    assert.equal(resolveMobileAndroidPackage(''), DEFAULT_MOBILE_ANDROID_PACKAGE);
    assert.equal(resolveMobileAndroidPackage('evil;package'), DEFAULT_MOBILE_ANDROID_PACKAGE);
    assert.equal(resolveMobileAndroidPackage('sk.tjm.vmp'), 'sk.tjm.vmp');
  });
});
