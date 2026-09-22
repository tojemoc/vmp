import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPageViewSessionKey,
  handleCmsPageView,
  logCmsPageViewEvent,
} from '../src/adminExtras.js';

describe('CMS page view session keys', () => {
  it('builds stable 30-minute session buckets', () => {
    const early = buildPageViewSessionKey({
      pageId: 'page-1',
      userId: 'u-1',
      timestampMs: 1_700_000_000_000,
    });
    const laterSameBucket = buildPageViewSessionKey({
      pageId: 'page-1',
      userId: 'u-1',
      timestampMs: 1_700_000_100_000,
    });
    const nextBucket = buildPageViewSessionKey({
      pageId: 'page-1',
      userId: 'u-1',
      timestampMs: 1_700_001_900_000,
    });
    assert.equal(early, laterSameBucket);
    assert.notEqual(early, nextBucket);
  });

  it('prefers authenticated user over client session and IP', () => {
    const key = buildPageViewSessionKey({
      pageId: 'page-1',
      userId: 'u-1',
      clientSessionId: 'browser-session',
      ipHash: 'abc',
      timestampMs: 1_700_000_000_000,
    });
    assert.match(key, /^page-1:u:u-1:/);
  });

  it('falls back to client session then IP for anonymous visitors', () => {
    const withClient = buildPageViewSessionKey({
      pageId: 'page-1',
      clientSessionId: 'browser-session',
      ipHash: 'abc',
      timestampMs: 1_700_000_000_000,
    });
    const withIp = buildPageViewSessionKey({
      pageId: 'page-1',
      ipHash: 'abc',
      timestampMs: 1_700_000_000_000,
    });
    assert.match(withClient, /^page-1:c:browser-session:/);
    assert.match(withIp, /^page-1:i:abc:/);
  });
});

describe('logCmsPageViewEvent', () => {
  it('writes event + increments lifetime count on new sessions', async () => {
    const captured: { sql: string; args: any[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            values: [] as any[],
            bind(...args: any[]) {
              this.values = args;
              return this;
            },
            async run() {
              captured.push({ sql, args: this.values });
              if (sql.includes('INSERT OR IGNORE INTO cms_page_view_count_sessions')) {
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      },
    };

    const result = await logCmsPageViewEvent(env, {
      pageId: 'page-1',
      pageSlug: 'about',
      path: '/about',
      referer: 'https://www.google.com/search?q=vmp',
      countryCode: 'sk',
      clientSessionId: 'sess-1',
      timestampMs: 1_700_000_000_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.isNewSession, true);
    assert.ok(captured.some((entry) => entry.sql.includes('INSERT INTO cms_page_view_events')));
    assert.ok(captured.some((entry) => entry.sql.includes('INSERT INTO cms_page_view_counts')));
    const eventInsert = captured.find((entry) =>
      entry.sql.includes('INSERT INTO cms_page_view_events'),
    );
    assert.equal(eventInsert?.args[1], 'page-1');
    assert.equal(eventInsert?.args[2], 'about');
    assert.equal(eventInsert?.args[8], 'search');
    assert.equal(eventInsert?.args[12], 'SK');
  });

  it('does not increment lifetime count for repeat sessions', async () => {
    const captured: { sql: string; args: any[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            values: [] as any[],
            bind(...args: any[]) {
              this.values = args;
              return this;
            },
            async run() {
              captured.push({ sql, args: this.values });
              if (sql.includes('INSERT OR IGNORE INTO cms_page_view_count_sessions')) {
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      },
    };

    const result = await logCmsPageViewEvent(env, {
      pageId: 'page-1',
      pageSlug: 'about',
      path: '/about',
      clientSessionId: 'sess-1',
      timestampMs: 1_700_000_000_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.isNewSession, false);
    assert.equal(
      captured.filter((entry) => entry.sql.includes('INSERT INTO cms_page_view_counts')).length,
      0,
    );
  });
});

describe('handleCmsPageView', () => {
  it('rejects unpublished or missing pages', async () => {
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return this;
            },
            async first() {
              return { id: 'page-1', slug: 'draft', status: 'draft' };
            },
          };
        },
      },
    };
    const request = new Request('http://localhost/api/analytics/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 'page-1' }),
    });
    const response = await handleCmsPageView(request, env, {});
    assert.equal(response.status, 404);
  });

  it('records a view for published pages', async () => {
    const captured: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            values: [] as any[],
            bind(...args: any[]) {
              this.values = args;
              return this;
            },
            async first() {
              if (sql.includes('FROM cms_pages')) {
                return { id: 'page-1', slug: 'about', status: 'published' };
              }
              return null;
            },
            async run() {
              captured.push(sql);
              if (sql.includes('INSERT OR IGNORE INTO cms_page_view_count_sessions')) {
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      },
    };
    const request = new Request('http://localhost/api/analytics/pageview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.10',
        'CF-IPCountry': 'CZ',
        referer: 'https://news.example/article',
      },
      body: JSON.stringify({
        pageId: 'page-1',
        path: '/about',
        clientSessionId: 'browser-1',
      }),
    });
    const response = await handleCmsPageView(request, env, { 'Access-Control-Allow-Origin': '*' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.counted, true);
    assert.ok(captured.some((sql) => sql.includes('INSERT INTO cms_page_view_events')));
  });
});
