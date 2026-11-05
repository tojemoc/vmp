import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  AUTH_URL_CREDENTIAL_PARAMS,
  hideAuthUrlCredentialsFromAddressBar,
  stripAuthUrlCredentials,
  withMagicLinkToken,
} from '../utils/authUrlCredentials';
import { buildAndroidNativeAppIntentUrl } from '../utils/nativeAppHandoff';

const FAKE_TOKEN = 'fake-magic-token-0123456789abcdef';
const FAKE_HANDOFF = 'fake-handoff-code';

describe('authUrlCredentials', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('masks magic-link token and handoff code in PostHog URL properties', () => {
    assert.deepEqual([...AUTH_URL_CREDENTIAL_PARAMS], ['token', 'handoff']);
  });

  it('strips credentials from absolute and relative verify URLs', () => {
    assert.equal(
      stripAuthUrlCredentials(
        `https://example.com/auth/verify?token=${FAKE_TOKEN}&client=native&redirect=%2Fwatch#x`,
      ),
      'https://example.com/auth/verify?client=native&redirect=%2Fwatch#x',
    );
    assert.equal(
      stripAuthUrlCredentials(`/auth/verify?handoff=${FAKE_HANDOFF}&client=pwa`),
      '/auth/verify?client=pwa',
    );
    assert.equal(stripAuthUrlCredentials('/auth/verify'), '/auth/verify');
  });

  it('restores the token for native handoff from a stripped URL', () => {
    const pageUrl = withMagicLinkToken('https://example.com/auth/verify?client=native', FAKE_TOKEN);
    assert.equal(new URL(pageUrl).searchParams.get('token'), FAKE_TOKEN);
    const intent = buildAndroidNativeAppIntentUrl(pageUrl, 'sk.tjm.vmp');
    assert.ok(intent.includes(`token=${FAKE_TOKEN}`));
  });

  it('hides credentials from the address bar and keeps history state', () => {
    const calls: Array<[unknown, string, string]> = [];
    const routerState = { current: '/auth/verify' };
    (globalThis as { window?: unknown }).window = {
      location: {
        pathname: '/auth/verify',
        search: `?token=${FAKE_TOKEN}&client=browser`,
        hash: '',
      },
      history: {
        state: routerState,
        replaceState: (state: unknown, unused: string, url: string) => {
          calls.push([state, unused, url]);
        },
      },
    };
    hideAuthUrlCredentialsFromAddressBar();
    assert.deepEqual(calls, [[routerState, '', '/auth/verify?client=browser']]);
    assert.ok(!calls[0]?.[2].includes(FAKE_TOKEN));
  });

  it('leaves the address bar alone when no credential is present', () => {
    let called = false;
    (globalThis as { window?: unknown }).window = {
      location: { pathname: '/auth/verify', search: '?client=browser', hash: '' },
      history: {
        state: null,
        replaceState: () => {
          called = true;
        },
      },
    };
    hideAuthUrlCredentialsFromAddressBar();
    assert.equal(called, false);
  });
});
