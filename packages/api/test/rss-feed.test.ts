import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAccessToken } from '../src/auth.js';
import { handlePersonalFeed } from '../src/feed.js';
import { handleGetAccountRss, handleRotateAccountRss } from '../src/rssAccount.js';
import { computeRssTokenHex, normalizeRssTokenVersion } from '../src/rssToken.js';
import { signVideoToken, verifyVideoToken } from '../src/videoTokens.js';

const RSS_SECRET = 'test-rss-secret-at-least-thirty-two-characters';
const JWT_SECRET = 'test-secret-at-least-thirty-two-characters-long';

// handlePersonalFeed reaches for the Workers cache; give it a no-op in Node.
(globalThis as any).caches = {
  default: { async match() {}, async put() {} },
};

class FakeFeedDb {
  users: any[];
  subscriptions: any[];
  videos: any[];
  settings: Record<string, string>;

  constructor(opts: {
    users?: any[];
    subscriptions?: any[];
    videos?: any[];
    settings?: Record<string, string>;
  }) {
    this.users = opts.users ?? [];
    this.subscriptions = opts.subscriptions ?? [];
    this.videos = opts.videos ?? [];
    this.settings = opts.settings ?? {};
  }

  prepare(sql: string) {
    const db = this;
    let bound: any[] = [];
    return {
      bind(...args: any[]) {
        bound = args;
        return this;
      },
      async first() {
        if (sql.includes('FROM admin_settings')) {
          const value = db.settings[bound[0]];
          return value == null ? null : { value };
        }
        if (sql.startsWith('UPDATE users') && sql.includes('rss_token_version')) {
          const user = db.users.find((u) => u.id === bound[0]);
          if (!user) return null;
          user.rss_token_version = Number(user.rss_token_version ?? 0) + 1;
          return { rss_token_version: user.rss_token_version };
        }
        if (sql.includes('FROM users') && sql.includes('rss_token_version')) {
          return db.users.find((u) => u.id === bound[0]) ?? null;
        }
        if (sql.includes('FROM users')) {
          const user = db.users.find((u) => u.id === bound[0]);
          return user ? { id: user.id, email: user.email, role: user.role } : null;
        }
        if (sql.includes('FROM subscriptions')) {
          return db.subscriptions.find((s) => s.user_id === bound[0]) ?? null;
        }
        return null;
      },
      async all() {
        if (sql.includes('FROM videos')) return { results: db.videos };
        return { results: [] };
      },
      async run() {
        return { meta: { changes: 1 } };
      },
    };
  }
}

function personalFeedRequest(userId: string, token: string) {
  return new Request(`https://api.example.com/api/feed/${encodeURIComponent(userId)}/${token}`);
}

async function authedRequest(method: string, url: string, userId: string) {
  const token = await createAccessToken(
    { id: userId, email: 'viewer@example.com', role: 'viewer' },
    JWT_SECRET,
  );
  return new Request(url, { method, headers: { Authorization: `Bearer ${token}` } });
}

describe('normalizeRssTokenVersion', () => {
  it('keeps positive integers', () => {
    assert.equal(normalizeRssTokenVersion(3), 3);
  });

  it('floors and clamps non-positive or invalid values to zero', () => {
    assert.equal(normalizeRssTokenVersion(0), 0);
    assert.equal(normalizeRssTokenVersion(-4), 0);
    assert.equal(normalizeRssTokenVersion(2.9), 2);
    assert.equal(normalizeRssTokenVersion('nope'), 0);
    assert.equal(normalizeRssTokenVersion(undefined), 0);
  });
});

describe('computeRssTokenHex', () => {
  it('is deterministic for the same inputs', async () => {
    const a = await computeRssTokenHex(RSS_SECRET, 'user-1', 0);
    const b = await computeRssTokenHex(RSS_SECRET, 'user-1', 0);
    assert.equal(a, b);
  });

  it('changes when the token version changes', async () => {
    const v0 = await computeRssTokenHex(RSS_SECRET, 'user-1', 0);
    const v1 = await computeRssTokenHex(RSS_SECRET, 'user-1', 1);
    assert.notEqual(v0, v1);
  });

  it('treats a missing version as version zero', async () => {
    const explicit = await computeRssTokenHex(RSS_SECRET, 'user-1', 0);
    const implicit = await computeRssTokenHex(RSS_SECRET, 'user-1');
    assert.equal(explicit, implicit);
  });

  it('preserves the legacy version-zero HMAC message without a :0 suffix', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(RSS_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const legacySig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode('rss:user-1'),
    );
    const legacyHex = Array.from(new Uint8Array(legacySig), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const v0 = await computeRssTokenHex(RSS_SECRET, 'user-1', 0);
    assert.equal(v0, legacyHex);
  });
});

describe('handleRotateAccountRss', () => {
  it('rejects an unauthenticated request', async () => {
    const env = { DB: new FakeFeedDb({}), JWT_SECRET, RSS_SECRET };
    const req = new Request('https://api.example.com/api/account/rss/rotate', { method: 'POST' });
    const res = await handleRotateAccountRss(req, env, {});
    assert.equal(res.status, 401);
  });

  it('returns 503 when RSS_SECRET is not configured', async () => {
    const env = {
      DB: new FakeFeedDb({ users: [{ id: 'u1', email: 'a@b.c', role: 'viewer' }] }),
      JWT_SECRET,
    };
    const req = await authedRequest('POST', 'https://api.example.com/api/account/rss/rotate', 'u1');
    const res = await handleRotateAccountRss(req, env, {});
    assert.equal(res.status, 503);
  });

  it('increments the version and returns a URL with the rotated token', async () => {
    const db = new FakeFeedDb({
      users: [{ id: 'u1', email: 'a@b.c', role: 'viewer', rss_token_version: 0 }],
    });
    const env = { DB: db, JWT_SECRET, RSS_SECRET };

    const before = await handleGetAccountRss(
      await authedRequest('GET', 'https://api.example.com/api/account/rss', 'u1'),
      env,
      {},
    );
    const beforeBody = await before.json();

    const res = await handleRotateAccountRss(
      await authedRequest('POST', 'https://api.example.com/api/account/rss/rotate', 'u1'),
      env,
      {},
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(db.users[0].rss_token_version, 1);
    const expected = await computeRssTokenHex(RSS_SECRET, 'u1', 1);
    assert.ok(body.personalUrl.endsWith(`/${expected}`));
    assert.equal(body.publicUrl, 'https://api.example.com/api/feed/public');
    assert.notEqual(body.personalUrl, beforeBody.personalUrl);
  });

  it('increments again on a second rotation', async () => {
    const db = new FakeFeedDb({
      users: [{ id: 'u1', email: 'a@b.c', role: 'viewer', rss_token_version: 0 }],
    });
    const env = { DB: db, JWT_SECRET, RSS_SECRET };
    await handleRotateAccountRss(
      await authedRequest('POST', 'https://api.example.com/api/account/rss/rotate', 'u1'),
      env,
      {},
    );
    await handleRotateAccountRss(
      await authedRequest('POST', 'https://api.example.com/api/account/rss/rotate', 'u1'),
      env,
      {},
    );
    assert.equal(db.users[0].rss_token_version, 2);
  });
});

describe('handlePersonalFeed token validation', () => {
  function feedEnv(rssTokenVersion: number) {
    return {
      DB: new FakeFeedDb({
        users: [{ id: 'u1', email: 'a@b.c', role: 'viewer', rss_token_version: rssTokenVersion }],
      }),
      RSS_SECRET,
    };
  }

  it('serves the feed for a token matching the stored version', async () => {
    const env = feedEnv(0);
    const token = await computeRssTokenHex(RSS_SECRET, 'u1', 0);
    const res = await handlePersonalFeed(personalFeedRequest('u1', token), env, {});
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type') ?? '', /rss\+xml/);
  });

  it('returns 404 for a wrong token', async () => {
    const env = feedEnv(0);
    const res = await handlePersonalFeed(personalFeedRequest('u1', 'deadbeef'), env, {});
    assert.equal(res.status, 404);
  });

  it('returns 404 for an unknown user', async () => {
    const env = feedEnv(0);
    const token = await computeRssTokenHex(RSS_SECRET, 'ghost', 0);
    const res = await handlePersonalFeed(personalFeedRequest('ghost', token), env, {});
    assert.equal(res.status, 404);
  });

  it('rejects a previously valid token after the version is rotated', async () => {
    const env = feedEnv(1); // user rotated once; live version is now 1
    const staleToken = await computeRssTokenHex(RSS_SECRET, 'u1', 0);
    const stale = await handlePersonalFeed(personalFeedRequest('u1', staleToken), env, {});
    assert.equal(stale.status, 404);

    const freshToken = await computeRssTokenHex(RSS_SECRET, 'u1', 1);
    const fresh = await handlePersonalFeed(personalFeedRequest('u1', freshToken), env, {});
    assert.equal(fresh.status, 200);
  });
});

describe('RSS video token version binding', () => {
  it('embeds rss_token_version in RSS-issued video tokens', async () => {
    const token = await signVideoToken('u1', 'vid-1', JWT_SECRET, null, {
      ttlSeconds: 3600,
      rssTokenVersion: 2,
    });
    const claims = await verifyVideoToken(token, JWT_SECRET);
    assert.equal(claims.rssTokenVersion, 2);
  });

  it('leaves rss_token_version unset for web playback tokens', async () => {
    const token = await signVideoToken('u1', 'vid-1', JWT_SECRET, 120);
    const claims = await verifyVideoToken(token, JWT_SECRET);
    assert.equal(claims.rssTokenVersion, null);
  });

  it('binds version zero explicitly when requested', async () => {
    const token = await signVideoToken('u1', 'vid-1', JWT_SECRET, null, {
      ttlSeconds: 3600,
      rssTokenVersion: 0,
    });
    const claims = await verifyVideoToken(token, JWT_SECRET);
    assert.equal(claims.rssTokenVersion, 0);
  });
});
