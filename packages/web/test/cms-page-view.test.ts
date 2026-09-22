import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { trackCmsPageView } from '../utils/cmsPageView';

describe('trackCmsPageView', () => {
  const originalFetch = globalThis.fetch;
  const originals: Record<string, unknown> = {};

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        // @ts-expect-error cleanup
        delete globalThis[key];
      } else {
        // @ts-expect-error restore
        globalThis[key] = value;
      }
    }
    Object.keys(originals).forEach((key) => {
      delete originals[key];
    });
  });

  function installBrowserStubs(opts: { search?: string; pathname?: string } = {}) {
    const store = new Map<string, string>();
    originals.window = (globalThis as { window?: unknown }).window;
    originals.document = (globalThis as { document?: unknown }).document;
    originals.sessionStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;
    originals.location = (globalThis as { location?: unknown }).location;

    const location = {
      search: opts.search ?? '',
      pathname: opts.pathname ?? '/about',
    };

    // @ts-expect-error test stub
    globalThis.window = globalThis;
    // @ts-expect-error test stub
    globalThis.document = { referrer: 'https://example.com/' };
    // @ts-expect-error test stub
    globalThis.location = location;
    // @ts-expect-error test stub
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
  }

  it('posts a pageview beacon with client session id', async () => {
    installBrowserStubs({ pathname: '/about', search: '' });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init || {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    await trackCmsPageView({
      pageId: 'page-1',
      slug: 'about',
      path: '/about',
      apiUrl: 'http://localhost:8787',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://localhost:8787/api/analytics/pageview');
    assert.equal(calls[0]?.init.method, 'POST');
    const body = JSON.parse(String(calls[0]?.init.body || '{}'));
    assert.equal(body.pageId, 'page-1');
    assert.equal(body.path, '/about');
    assert.ok(typeof body.clientSessionId === 'string' && body.clientSessionId.length > 0);
  });

  it('skips preview mode and missing page ids', async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async () => {
      calls.push(1);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    installBrowserStubs({ search: '?preview=1' });
    await trackCmsPageView({
      pageId: 'page-1',
      apiUrl: 'http://localhost:8787',
    });
    assert.equal(calls.length, 0);

    installBrowserStubs({ search: '' });
    await trackCmsPageView({
      pageId: '',
      apiUrl: 'http://localhost:8787',
    });
    assert.equal(calls.length, 0);
  });
});
