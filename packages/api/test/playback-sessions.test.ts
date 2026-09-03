import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  claimPlaybackSessionSlot,
  enforceConcurrentPlaybackLimit,
  normalizeSessionId,
  PLAYBACK_SESSION_HEADER_NAME,
  parsePlaybackSessionSettings,
  resolveConcurrentPlaybackLimit,
} from '../src/playbackSessions.js';
import { POSTHOG_TRACING_REQUEST_HEADERS } from '../src/posthog.js';
import { resetSettingsCacheForTests } from '../src/settingsStore.js';

describe('parsePlaybackSessionSettings', () => {
  it('parses stored string values and enables only on 1/true', () => {
    const settings = parsePlaybackSessionSettings({
      enforced: '1',
      limitDefault: '1',
      limitClub: '3',
      staleSeconds: '90',
    });
    assert.deepEqual(settings, {
      enforced: true,
      limitDefault: 1,
      limitClub: 3,
      staleSeconds: 90,
    });
    assert.equal(parsePlaybackSessionSettings({ enforced: 'TRUE' } as never).enforced, true);
  });

  it('treats any other flag value as disabled', () => {
    for (const enforced of ['0', '', 'yes', undefined, null]) {
      assert.equal(parsePlaybackSessionSettings({ enforced } as never).enforced, false);
    }
  });

  it('falls back to safe defaults for missing or invalid numbers', () => {
    const settings = parsePlaybackSessionSettings({
      enforced: '0',
      limitDefault: 'nope',
      limitClub: '0',
      staleSeconds: '-5',
    });
    assert.deepEqual(settings, {
      enforced: false,
      limitDefault: 1,
      limitClub: 3,
      staleSeconds: 90,
    });
  });
});

describe('resolveConcurrentPlaybackLimit', () => {
  const settings = parsePlaybackSessionSettings({
    enforced: '1',
    limitDefault: '1',
    limitClub: '3',
    staleSeconds: '90',
  });

  it('gives club its own cap', () => {
    assert.equal(resolveConcurrentPlaybackLimit('club', settings), 3);
    assert.equal(resolveConcurrentPlaybackLimit('CLUB', settings), 3);
  });

  it('gives every other plan the default', () => {
    assert.equal(resolveConcurrentPlaybackLimit('monthly', settings), 1);
    assert.equal(resolveConcurrentPlaybackLimit('yearly', settings), 1);
    assert.equal(resolveConcurrentPlaybackLimit(null, settings), 1);
    assert.equal(resolveConcurrentPlaybackLimit(undefined, settings), 1);
  });
});

describe('normalizeSessionId', () => {
  it('accepts a bounded single-segment id', () => {
    assert.equal(
      normalizeSessionId('550e8400-e29b-41d4-a716-446655440000'),
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('rejects empty, oversized, path-like, and non-string values', () => {
    assert.equal(normalizeSessionId(''), null);
    assert.equal(normalizeSessionId('   '), null);
    assert.equal(normalizeSessionId('a'.repeat(201)), null);
    assert.equal(normalizeSessionId('a/b'), null);
    assert.equal(normalizeSessionId('..'), null);
    assert.equal(normalizeSessionId(42), null);
    assert.equal(normalizeSessionId(undefined), null);
  });
});

describe('PLAYBACK_SESSION_HEADER_NAME CORS preflight', () => {
  it('exports the header browsers must be allowed to send', () => {
    assert.equal(PLAYBACK_SESSION_HEADER_NAME, 'X-VMP-Playback-Session');
  });

  it('is included in the API OPTIONS Access-Control-Allow-Headers mirror', () => {
    // Keep in sync with packages/api/src/index.ts OPTIONS handler.
    const allowHeaders =
      'Content-Type, Authorization, Range, x-d1-bookmark, X-VMP-Device-Token, ' +
      `${PLAYBACK_SESSION_HEADER_NAME}, ` +
      POSTHOG_TRACING_REQUEST_HEADERS.join(', ');
    assert.match(allowHeaders, /X-VMP-Playback-Session/);
    assert.ok(
      allowHeaders.split(', ').includes(PLAYBACK_SESSION_HEADER_NAME),
      'preflight Allow-Headers must list the playback session header',
    );
  });
});

type SessionRow = {
  id: string;
  user_id: string;
  video_id: string;
  last_seen_at: string;
};

/** Minimal D1-like mock that evaluates the atomic claim INSERT…WHERE count < limit. */
function createPlaybackSessionDb(options: {
  settings: Record<string, string>;
  sessions?: SessionRow[];
}) {
  const sessions: SessionRow[] = [...(options.sessions ?? [])];
  const settings = { ...options.settings };

  function isActive(row: SessionRow, staleSeconds: number) {
    const lastSeen = Date.parse(row.last_seen_at);
    return Number.isFinite(lastSeen) && Date.now() - lastSeen <= staleSeconds * 1000;
  }

  return {
    sessions,
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds.length = 0;
          binds.push(...args);
          return stmt;
        },
        async first() {
          if (normalized.includes('FROM admin_settings')) {
            const key = String(binds[0]);
            if (key === 'settings_changed_at') return { value: '1' };
            if (key in settings) return { value: settings[key] };
            return null;
          }
          if (normalized.includes('FROM subscriptions')) {
            return { plan_type: settings.__plan_type ?? 'monthly' };
          }
          return null;
        },
        async run() {
          if (
            normalized.startsWith('INSERT INTO playback_sessions') &&
            normalized.includes('WHERE')
          ) {
            const [sessionId, userId, videoId, , staleExpr, limit] = binds as [
              string,
              string,
              string,
              string,
              string,
              number,
            ];
            const staleSeconds =
              Math.abs(Number.parseInt(String(staleExpr).replace(/\D/g, ''), 10)) || 90;
            const activeCount = sessions.filter(
              (row) => row.user_id === userId && isActive(row, staleSeconds),
            ).length;
            if (activeCount >= Number(limit)) {
              return { meta: { changes: 0 } };
            }
            sessions.push({
              id: sessionId,
              user_id: userId,
              video_id: videoId,
              last_seen_at: new Date().toISOString(),
            });
            return { meta: { changes: 1 } };
          }
          if (normalized.startsWith('INSERT INTO playback_sessions')) {
            const [sessionId, userId, videoId] = binds as [string, string, string];
            sessions.push({
              id: sessionId,
              user_id: userId,
              video_id: videoId,
              last_seen_at: new Date().toISOString(),
            });
            return { meta: { changes: 1 } };
          }
          if (normalized.startsWith('UPDATE playback_sessions')) {
            const [videoId, sessionId, userId] = binds as [string, string, string];
            const row = sessions.find((s) => s.id === sessionId && s.user_id === userId);
            if (!row) return { meta: { changes: 0 } };
            row.video_id = videoId;
            row.last_seen_at = new Date().toISOString();
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
}

describe('claimPlaybackSessionSlot', () => {
  it('inserts when under the limit and rejects when at capacity (limit of one)', async () => {
    const db = createPlaybackSessionDb({
      settings: {},
      sessions: [],
    });

    const first = await claimPlaybackSessionSlot(db, {
      sessionId: 'sess-1',
      userId: 'user-1',
      videoId: 'vid-1',
      limit: 1,
      staleSeconds: 90,
    });
    assert.equal(first, true);
    assert.equal(db.sessions.length, 1);

    const second = await claimPlaybackSessionSlot(db, {
      sessionId: 'sess-2',
      userId: 'user-1',
      videoId: 'vid-2',
      limit: 1,
      staleSeconds: 90,
    });
    assert.equal(second, false);
    assert.equal(db.sessions.length, 1);
  });

  it('serializes concurrent claims so only one wins at limit one', async () => {
    const db = createPlaybackSessionDb({ settings: {}, sessions: [] });
    const results = await Promise.all([
      claimPlaybackSessionSlot(db, {
        sessionId: 'race-a',
        userId: 'user-1',
        videoId: 'vid-a',
        limit: 1,
        staleSeconds: 90,
      }),
      claimPlaybackSessionSlot(db, {
        sessionId: 'race-b',
        userId: 'user-1',
        videoId: 'vid-b',
        limit: 1,
        staleSeconds: 90,
      }),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(db.sessions.length, 1);
  });
});

describe('enforceConcurrentPlaybackLimit', () => {
  function envWith(db: ReturnType<typeof createPlaybackSessionDb>) {
    return { DB: db };
  }

  it('is inert when enforcement is disabled even without a session header', async () => {
    resetSettingsCacheForTests();
    const db = createPlaybackSessionDb({
      settings: {
        concurrent_playback_enforced: '0',
        concurrent_playback_limit_default: '1',
        concurrent_playback_limit_club: '3',
        concurrent_playback_stale_seconds: '90',
      },
    });
    const response = await enforceConcurrentPlaybackLimit(
      new Request('https://example.com/api/video-access/v1'),
      envWith(db),
      undefined,
      { userId: 'user-1', planType: 'monthly', videoId: 'vid-1', corsHeaders: {} },
    );
    assert.equal(response, null);
  });

  it('rejects missing session header when enforcement is enabled', async () => {
    resetSettingsCacheForTests();
    const db = createPlaybackSessionDb({
      settings: {
        concurrent_playback_enforced: '1',
        concurrent_playback_limit_default: '1',
        concurrent_playback_limit_club: '3',
        concurrent_playback_stale_seconds: '90',
      },
    });
    const response = await enforceConcurrentPlaybackLimit(
      new Request('https://example.com/api/video-access/v1'),
      envWith(db),
      undefined,
      { userId: 'user-1', planType: 'monthly', videoId: 'vid-1', corsHeaders: {} },
    );
    assert.ok(response);
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code: string };
    assert.equal(body.code, 'playback_session_required');
  });

  it('rejects client-selected ids that were never server-issued for the user', async () => {
    resetSettingsCacheForTests();
    const db = createPlaybackSessionDb({
      settings: {
        concurrent_playback_enforced: '1',
        concurrent_playback_limit_default: '1',
        concurrent_playback_limit_club: '3',
        concurrent_playback_stale_seconds: '90',
      },
      sessions: [],
    });
    const response = await enforceConcurrentPlaybackLimit(
      new Request('https://example.com/api/video-access/v1', {
        headers: { 'X-VMP-Playback-Session': 'client-invented-id' },
      }),
      envWith(db),
      undefined,
      { userId: 'user-1', planType: 'monthly', videoId: 'vid-1', corsHeaders: {} },
    );
    assert.ok(response);
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code: string };
    assert.equal(body.code, 'playback_session_required');
    assert.equal(db.sessions.length, 0);
  });

  it('accepts a server-issued session bound to the authenticated user', async () => {
    resetSettingsCacheForTests();
    const db = createPlaybackSessionDb({
      settings: {
        concurrent_playback_enforced: '1',
        concurrent_playback_limit_default: '1',
        concurrent_playback_limit_club: '3',
        concurrent_playback_stale_seconds: '90',
      },
      sessions: [
        {
          id: 'server-minted',
          user_id: 'user-1',
          video_id: 'vid-old',
          last_seen_at: new Date().toISOString(),
        },
      ],
    });
    const response = await enforceConcurrentPlaybackLimit(
      new Request('https://example.com/api/video-access/v1', {
        headers: { 'X-VMP-Playback-Session': 'server-minted' },
      }),
      envWith(db),
      undefined,
      { userId: 'user-1', planType: 'monthly', videoId: 'vid-1', corsHeaders: {} },
    );
    assert.equal(response, null);
    assert.equal(db.sessions[0]?.video_id, 'vid-1');
  });

  it('does not let a reused foreign session id mint a second stream for the caller', async () => {
    resetSettingsCacheForTests();
    const db = createPlaybackSessionDb({
      settings: {
        concurrent_playback_enforced: '1',
        concurrent_playback_limit_default: '1',
        concurrent_playback_limit_club: '3',
        concurrent_playback_stale_seconds: '90',
      },
      sessions: [
        {
          id: 'other-users-session',
          user_id: 'user-2',
          video_id: 'vid-x',
          last_seen_at: new Date().toISOString(),
        },
      ],
    });
    const response = await enforceConcurrentPlaybackLimit(
      new Request('https://example.com/api/video-access/v1', {
        headers: { 'X-VMP-Playback-Session': 'other-users-session' },
      }),
      envWith(db),
      undefined,
      { userId: 'user-1', planType: 'monthly', videoId: 'vid-1', corsHeaders: {} },
    );
    assert.ok(response);
    assert.equal(response.status, 409);
    assert.equal(db.sessions.length, 1);
    assert.equal(db.sessions[0]?.user_id, 'user-2');
  });
});
