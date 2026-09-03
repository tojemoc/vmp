import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSessionId,
  parsePlaybackSessionSettings,
  resolveConcurrentPlaybackLimit,
} from '../src/playbackSessions.js';

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
