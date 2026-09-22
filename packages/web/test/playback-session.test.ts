import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseConcurrentPlaybackError,
  PLAYBACK_SESSION_HEADER,
  PLAYBACK_SESSION_HEARTBEAT_MS,
  shouldClaimPlaybackSession,
} from '../composables/usePlaybackSession';

describe('shouldClaimPlaybackSession', () => {
  it('claims for logged-in premium viewers', () => {
    assert.equal(
      shouldClaimPlaybackSession({
        isLoggedIn: true,
        isPremium: true,
        role: 'viewer',
      }),
      true,
    );
  });

  it('skips anonymous and free users', () => {
    assert.equal(
      shouldClaimPlaybackSession({
        isLoggedIn: false,
        isPremium: false,
        role: null,
      }),
      false,
    );
    assert.equal(
      shouldClaimPlaybackSession({
        isLoggedIn: true,
        isPremium: false,
        role: 'viewer',
      }),
      false,
    );
  });

  it('skips staff roles (server bypasses concurrent limits)', () => {
    assert.equal(
      shouldClaimPlaybackSession({
        isLoggedIn: true,
        isPremium: true,
        role: 'editor',
      }),
      false,
    );
    assert.equal(
      shouldClaimPlaybackSession({
        isLoggedIn: true,
        isPremium: true,
        role: 'admin',
      }),
      false,
    );
  });
});

describe('parseConcurrentPlaybackError', () => {
  it('parses concurrent_playback_limit with limit', () => {
    const err = parseConcurrentPlaybackError(409, {
      error: 'Concurrent stream limit reached',
      code: 'concurrent_playback_limit',
      limit: 3,
    });
    assert.ok(err);
    assert.equal(err.code, 'concurrent_playback_limit');
    assert.equal(err.limit, 3);
  });

  it('parses playback_session_required', () => {
    const err = parseConcurrentPlaybackError(409, {
      code: 'playback_session_required',
      error: 'Playback session required',
    });
    assert.ok(err);
    assert.equal(err.code, 'playback_session_required');
    assert.equal(err.limit, undefined);
  });

  it('ignores unrelated statuses and codes', () => {
    assert.equal(parseConcurrentPlaybackError(400, { code: 'concurrent_playback_limit' }), null);
    assert.equal(parseConcurrentPlaybackError(409, { code: 'other' }), null);
  });
});

describe('playback session constants', () => {
  it('matches API header and heartbeat interval', () => {
    assert.equal(PLAYBACK_SESSION_HEADER, 'X-VMP-Playback-Session');
    assert.equal(PLAYBACK_SESSION_HEARTBEAT_MS, 30_000);
  });
});
