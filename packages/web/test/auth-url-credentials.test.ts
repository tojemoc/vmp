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
const FAKE_PWA_HANDOFF = 'fake-pwa-auth-handoff-code';

describe('authUrlCredentials', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('masks magic-link and PWA handoff credentials in PostHog URL properties', () => {
    assert.deepEqual([...AUTH_URL_CREDENTIAL_PARAMS], ['token', 'handoff', 'pwa_auth_handoff']);
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
    assert.equal(
      stripAuthUrlCredentials(`/?pwa_auth_handoff=${FAKE_PWA_HANDOFF}&client=pwa`),
      '/?client=pwa',
    );
    assert.equal(stripAuthUrlCredentials('/auth/verify'), '/auth/verify');
  });

  it('restores the token for native handoff from a stripped URL', () => {
    const pageUrl = withMagicLinkToken('https://example.com/auth/verify?client=native', FAKE_TOKEN);
    assert.equal(new URL(pageUrl).searchParams.get('token'), FAKE_TOKEN);
    const intent = buildAndroidNativeAppIntentUrl(pageUrl, 'sk.tjm.vmp');
    assert.ok(intent.includes(`token=${FAKE_TOKEN}`));
  });

  it('hides credentials before a pre-mount browser log reads the URL', () => {
    const location = {
      href: `https://example.com/?token=${FAKE_TOKEN}&pwa_auth_handoff=${FAKE_PWA_HANDOFF}&client=pwa`,
      pathname: '/',
      search: `?token=${FAKE_TOKEN}&pwa_auth_handoff=${FAKE_PWA_HANDOFF}&client=pwa`,
      hash: '',
    };
    (globalThis as { window?: unknown }).window = {
      location,
      history: {
        state: { current: location.pathname + location.search, marker: 'preserved' },
        replaceState: (_state: unknown, _unused: string, url: string) => {
          const next = new URL(url, location.href);
          location.href = next.toString();
          location.pathname = next.pathname;
          location.search = next.search;
          location.hash = next.hash;
        },
      },
    };

    hideAuthUrlCredentialsFromAddressBar();

    const preMountLogUrl = (
      (globalThis as { window?: { location: { href: string } } }).window as {
        location: { href: string };
      }
    ).location.href;
    assert.ok(!preMountLogUrl.includes(FAKE_TOKEN));
    assert.ok(!preMountLogUrl.includes(FAKE_PWA_HANDOFF));
    assert.equal(new URL(preMountLogUrl).searchParams.get('client'), 'pwa');
  });

  it('updates router current state so redirect and Back keep credentials hidden', () => {
    const calls: Array<[unknown, string, string]> = [];
    const historyEntries: Array<{ state: Record<string, unknown>; url: string }> = [
      {
        state: {
          back: null,
          current: `/auth/verify?token=${FAKE_TOKEN}&client=browser`,
          forward: null,
          position: 0,
          replaced: false,
          marker: 'preserved',
        },
        url: `https://example.com/auth/verify?token=${FAKE_TOKEN}&client=browser`,
      },
    ];
    let historyIndex = 0;
    const currentEntry = () => {
      const entry = historyEntries[historyIndex];
      if (!entry) throw new Error('Missing current history entry');
      return entry;
    };
    const location = {
      pathname: '/auth/verify',
      search: `?token=${FAKE_TOKEN}&client=browser`,
      hash: '',
      href: currentEntry().url,
    };
    (globalThis as { window?: unknown }).window = {
      location,
      history: {
        get state() {
          return currentEntry().state;
        },
        replaceState: (state: Record<string, unknown>, unused: string, url: string) => {
          calls.push([state, unused, url]);
          Object.assign(currentEntry(), { state, url: new URL(url, location.href).toString() });
          Object.assign(location, {
            pathname: new URL(url, location.href).pathname,
            search: new URL(url, location.href).search,
            hash: new URL(url, location.href).hash,
            href: new URL(url, location.href).toString(),
          });
        },
        pushState: (state: Record<string, unknown>, _unused: string, url: string) => {
          historyEntries.splice(historyIndex + 1);
          historyEntries.push({ state, url: new URL(url, location.href).toString() });
          historyIndex += 1;
          const next = new URL(url, location.href);
          Object.assign(location, {
            pathname: next.pathname,
            search: next.search,
            hash: next.hash,
            href: next.toString(),
          });
        },
        back: () => {
          historyIndex -= 1;
          const previous = new URL(currentEntry().url);
          Object.assign(location, {
            pathname: previous.pathname,
            search: previous.search,
            hash: previous.hash,
            href: previous.toString(),
          });
        },
      },
    };

    hideAuthUrlCredentialsFromAddressBar();

    assert.deepEqual(calls, [
      [
        {
          back: null,
          current: '/auth/verify?client=browser',
          forward: null,
          position: 0,
          replaced: false,
          marker: 'preserved',
        },
        '',
        '/auth/verify?client=browser',
      ],
    ]);
    assert.equal(currentEntry().state.current, '/auth/verify?client=browser');
    assert.equal(currentEntry().state.marker, 'preserved');
    assert.ok(!calls[0]?.[2].includes(FAKE_TOKEN));

    const previousCurrent = currentEntry().state.current;
    const redirectUrl = '/watch/video-1';
    const redirectState = {
      ...currentEntry().state,
      back: previousCurrent,
      current: redirectUrl,
      position: 1,
    };
    const testWindow = (
      globalThis as {
        window?: {
          history: {
            pushState: (state: Record<string, unknown>, unused: string, url: string) => void;
            back: () => void;
            state: Record<string, unknown>;
          };
        };
      }
    ).window;
    assert.ok(testWindow);
    testWindow.history.pushState(redirectState, '', redirectUrl);
    testWindow.history.back();

    assert.equal(location.href, 'https://example.com/auth/verify?client=browser');
    assert.equal(testWindow.history.state.current, '/auth/verify?client=browser');
    assert.ok(!location.href.includes(FAKE_TOKEN));
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
