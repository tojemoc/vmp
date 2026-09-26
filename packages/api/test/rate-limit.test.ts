import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  anonymousRateLimitClientKey,
  checkAnonymousRateLimit,
  isAnonymousWatchViewRequest,
  WATCH_VIEW_HEADER,
} from '../src/rateLimit.js';
import { resetSettingsCacheForTests } from '../src/settingsStore.js';

type RateRow = {
  ip: string;
  bucket_hour: string;
  request_count: number;
  expires_at: string;
};

class FakeRateLimitDb {
  rows: RateRow[] = [];
  settings = new Map<string, string>([
    ['settings_changed_at', '0'],
    ['rate_limit_anon', '5'],
  ]);

  prepare(sql: string) {
    const db = this;
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first() {
            if (normalized.startsWith('SELECT value FROM admin_settings')) {
              const key = String(args[0]);
              const value = db.settings.get(key);
              return value == null ? null : { value };
            }
            if (normalized.includes('INSERT INTO anonymous_rate_limits')) {
              const ip = String(args[0]);
              const bucketHour = String(args[1]);
              const existing = db.rows.find((r) => r.ip === ip && r.bucket_hour === bucketHour);
              if (existing) {
                existing.request_count += 1;
                existing.expires_at = new Date(Date.now() + 3700_000).toISOString();
                return { request_count: existing.request_count };
              }
              const row: RateRow = {
                ip,
                bucket_hour: bucketHour,
                request_count: 1,
                expires_at: new Date(Date.now() + 3700_000).toISOString(),
              };
              db.rows.push(row);
              return { request_count: 1 };
            }
            return null;
          },
          async run() {
            if (normalized.startsWith('DELETE FROM anonymous_rate_limits')) {
              const before = db.rows.length;
              db.rows = [];
              return { meta: { changes: before } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
  }
}

function requestWith(headers: Record<string, string>) {
  return new Request('https://example.test/api/video-access/vid-1', {
    method: 'GET',
    headers,
  });
}

describe('isAnonymousWatchViewRequest', () => {
  it('accepts 1 / true and rejects missing or other values', () => {
    assert.equal(isAnonymousWatchViewRequest(requestWith({ [WATCH_VIEW_HEADER]: '1' })), true);
    assert.equal(isAnonymousWatchViewRequest(requestWith({ [WATCH_VIEW_HEADER]: 'true' })), true);
    assert.equal(isAnonymousWatchViewRequest(requestWith({ [WATCH_VIEW_HEADER]: 'TRUE' })), true);
    assert.equal(isAnonymousWatchViewRequest(requestWith({})), false);
    assert.equal(isAnonymousWatchViewRequest(requestWith({ [WATCH_VIEW_HEADER]: '0' })), false);
    assert.equal(
      isAnonymousWatchViewRequest(requestWith({ [WATCH_VIEW_HEADER]: 'prefetch' })),
      false,
    );
  });
});

describe('anonymousRateLimitClientKey', () => {
  it('keys only on User-Agent (same UA → same key; IP ignored)', async () => {
    const ua = 'Mozilla/5.0 (Test) VMP/1';
    const a = await anonymousRateLimitClientKey(
      requestWith({ 'User-Agent': ua, 'CF-Connecting-IP': '1.1.1.1' }),
    );
    const b = await anonymousRateLimitClientKey(
      requestWith({ 'User-Agent': ua, 'CF-Connecting-IP': '8.8.8.8' }),
    );
    const c = await anonymousRateLimitClientKey(
      requestWith({ 'User-Agent': `${ua}-other`, 'CF-Connecting-IP': '1.1.1.1' }),
    );
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe('checkAnonymousRateLimit', () => {
  beforeEach(() => {
    resetSettingsCacheForTests();
  });

  it('increments per watch open and blocks after limit', async () => {
    const db = new FakeRateLimitDb();
    db.settings.set('rate_limit_anon', '2');
    const env = { DB: db };
    const headers = { 'User-Agent': 'Mozilla/5.0 RateLimitTest', [WATCH_VIEW_HEADER]: '1' };

    const first = await checkAnonymousRateLimit(requestWith(headers), env);
    assert.deepEqual(first, { limited: false, current: 1, limit: 2 });

    const second = await checkAnonymousRateLimit(requestWith(headers), env);
    assert.deepEqual(second, { limited: false, current: 2, limit: 2 });

    const third = await checkAnonymousRateLimit(requestWith(headers), env);
    assert.equal(third?.limited, true);
    assert.equal(third?.current, 3);
    assert.equal(third?.limit, 2);
    assert.ok(typeof third?.retryAfter === 'number' && third.retryAfter > 0);
  });

  it('does not share buckets across different User-Agents', async () => {
    const db = new FakeRateLimitDb();
    db.settings.set('rate_limit_anon', '1');
    const env = { DB: db };

    const a = await checkAnonymousRateLimit(
      requestWith({ 'User-Agent': 'Browser-A', [WATCH_VIEW_HEADER]: '1' }),
      env,
    );
    const b = await checkAnonymousRateLimit(
      requestWith({ 'User-Agent': 'Browser-B', [WATCH_VIEW_HEADER]: '1' }),
      env,
    );
    assert.equal(a?.limited, false);
    assert.equal(b?.limited, false);
    assert.equal(db.rows.length, 2);
  });

  it('returns null when D1 is not bound', async () => {
    assert.equal(await checkAnonymousRateLimit(requestWith({}), {}), null);
  });
});
