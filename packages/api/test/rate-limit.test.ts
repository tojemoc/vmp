import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  ANON_ID_COOKIE_NAME,
  checkAnonymousRateLimit,
  isAnonymousWatchViewRequest,
  resolveAnonymousClientIdentity,
  WATCH_VIEW_HEADER,
} from '../src/rateLimit.js';
import { resetSettingsCacheForTests } from '../src/settingsStore.js';

const JWT_SECRET = 'test-secret-at-least-thirty-two-characters-long';

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
              // Mirror SQL: DELETE … WHERE expires_at <= CURRENT_TIMESTAMP
              const now = Date.now();
              const before = db.rows.length;
              db.rows = db.rows.filter((r) => {
                const expiresAt = Date.parse(r.expires_at);
                return Number.isFinite(expiresAt) && expiresAt > now;
              });
              return { meta: { changes: before - db.rows.length } };
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

function cookieHeaderFromSetCookie(setCookie: string): string {
  const pair = setCookie.split(';')[0];
  assert.ok(pair?.includes('='));
  return pair;
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

describe('resolveAnonymousClientIdentity', () => {
  it('mints a signed cookie and reuses the same key when the cookie is returned', async () => {
    const first = await resolveAnonymousClientIdentity(requestWith({}), { JWT_SECRET });
    assert.ok(first);
    assert.ok(first.setCookie);
    assert.match(first.setCookie, new RegExp(`^${ANON_ID_COOKIE_NAME}=`));
    assert.match(first.clientKey, /^[0-9a-f]{64}$/);

    const second = await resolveAnonymousClientIdentity(
      requestWith({ Cookie: cookieHeaderFromSetCookie(first.setCookie) }),
      { JWT_SECRET },
    );
    assert.ok(second);
    assert.equal(second.rawId, first.rawId);
    assert.equal(second.clientKey, first.clientKey);
    assert.equal(second.setCookie, null);
  });

  it('rejects a tampered cookie and mints a fresh identity', async () => {
    const first = await resolveAnonymousClientIdentity(requestWith({}), { JWT_SECRET });
    assert.ok(first?.setCookie);
    const pair = cookieHeaderFromSetCookie(first.setCookie);
    const value = decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
    const [rawId] = value.split('.');
    const tampered = `${ANON_ID_COOKIE_NAME}=${encodeURIComponent(`${rawId}.${'ab'.repeat(32)}`)}`;

    const next = await resolveAnonymousClientIdentity(requestWith({ Cookie: tampered }), {
      JWT_SECRET,
    });
    assert.ok(next);
    assert.notEqual(next.rawId, first.rawId);
    assert.ok(next.setCookie);
  });

  it('returns null when JWT_SECRET is missing', async () => {
    assert.equal(await resolveAnonymousClientIdentity(requestWith({}), {}), null);
  });
});

describe('FakeRateLimitDb cleanup', () => {
  it('deletes only expired rows', async () => {
    const db = new FakeRateLimitDb();
    db.rows.push(
      {
        ip: 'keep',
        bucket_hour: '2026-09-26T18',
        request_count: 2,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        ip: 'drop',
        bucket_hour: '2026-09-26T17',
        request_count: 9,
        expires_at: new Date(Date.now() - 1_000).toISOString(),
      },
    );
    const result = await db
      .prepare('DELETE FROM anonymous_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP')
      .bind()
      .run();
    assert.equal(result.meta.changes, 1);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0]?.ip, 'keep');
  });
});

describe('checkAnonymousRateLimit', () => {
  beforeEach(() => {
    resetSettingsCacheForTests();
  });

  it('increments per watch open and blocks after limit', async () => {
    const db = new FakeRateLimitDb();
    db.settings.set('rate_limit_anon', '2');
    const env = { DB: db, JWT_SECRET };
    const identity = await resolveAnonymousClientIdentity(requestWith({}), env);
    assert.ok(identity);

    const first = await checkAnonymousRateLimit(env, identity.clientKey);
    assert.deepEqual(first, { limited: false, current: 1, limit: 2 });

    const second = await checkAnonymousRateLimit(env, identity.clientKey);
    assert.deepEqual(second, { limited: false, current: 2, limit: 2 });

    const third = await checkAnonymousRateLimit(env, identity.clientKey);
    assert.equal(third?.limited, true);
    assert.equal(third?.current, 3);
    assert.equal(third?.limit, 2);
    assert.ok(typeof third?.retryAfter === 'number' && third.retryAfter > 0);
  });

  it('does not share buckets across different anonymous ids', async () => {
    const db = new FakeRateLimitDb();
    db.settings.set('rate_limit_anon', '1');
    const env = { DB: db, JWT_SECRET };

    const a = await resolveAnonymousClientIdentity(requestWith({}), env);
    const b = await resolveAnonymousClientIdentity(requestWith({}), env);
    assert.ok(a && b);
    assert.notEqual(a.clientKey, b.clientKey);

    assert.equal((await checkAnonymousRateLimit(env, a.clientKey))?.limited, false);
    assert.equal((await checkAnonymousRateLimit(env, b.clientKey))?.limited, false);
    assert.equal(db.rows.length, 2);
  });

  it('returns null when D1 is not bound', async () => {
    assert.equal(await checkAnonymousRateLimit({}, 'any-key'), null);
  });
});
