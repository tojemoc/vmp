import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { canAddToHomeScreenWithoutPrompt, isInstalledPwa, isIosLike } from '../utils/pwa';

describe('pwa offline-download surface helpers', () => {
  const originalNavigator = globalThis.navigator;
  const originalMatchMedia = globalThis.window?.matchMedia;
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      if (originalMatchMedia) {
        globalThis.window.matchMedia = originalMatchMedia;
      }
    } else {
      // @ts-expect-error restore missing window in node
      delete globalThis.window;
    }
  });

  function mockWindow(partial: {
    ua?: string;
    platform?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    displayMode?: string;
  }) {
    const matchMedia = (query: string) => ({
      matches:
        (partial.displayMode === 'standalone' && query.includes('display-mode: standalone')) ||
        (partial.displayMode === 'fullscreen' && query.includes('display-mode: fullscreen')),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
      onchange: null,
    });

    const nav = {
      userAgent: partial.ua ?? 'Mozilla/5.0',
      platform: partial.platform ?? 'Linux x86_64',
      maxTouchPoints: partial.maxTouchPoints ?? 0,
      standalone: partial.standalone,
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        navigator: nav,
        matchMedia,
      },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: nav,
    });
  }

  it('detects iOS Safari as Add-to-Home-Screen capable when not installed', () => {
    mockWindow({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    assert.equal(isIosLike(), true);
    assert.equal(isInstalledPwa(), false);
    assert.equal(canAddToHomeScreenWithoutPrompt(), true);
  });

  it('does not offer Add-to-Home-Screen when already installed on iOS', () => {
    mockWindow({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      standalone: true,
    });
    assert.equal(isInstalledPwa(), true);
    assert.equal(canAddToHomeScreenWithoutPrompt(), false);
  });

  it('does not treat desktop Chrome as iOS Add-to-Home-Screen', () => {
    mockWindow({
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      platform: 'Win32',
    });
    assert.equal(isIosLike(), false);
    assert.equal(canAddToHomeScreenWithoutPrompt(), false);
  });
});
