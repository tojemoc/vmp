import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyPlaybackPosition,
  normalizeOptionalDurationSeconds,
  normalizePositionSeconds,
  PLAYBACK_POSITION_MIN_SAVE_SECONDS,
  shouldThrottlePlaybackWrite,
} from '../src/playbackPositions.js';

describe('normalizePositionSeconds', () => {
  it('accepts finite non-negative numbers', () => {
    assert.equal(normalizePositionSeconds(0), 0);
    assert.equal(normalizePositionSeconds(12.5), 12.5);
    assert.equal(normalizePositionSeconds('90'), 90);
  });

  it('rejects invalid values', () => {
    assert.equal(normalizePositionSeconds(-1), null);
    assert.equal(normalizePositionSeconds(Number.NaN), null);
    assert.equal(normalizePositionSeconds('nope'), null);
    assert.equal(normalizePositionSeconds(undefined), null);
  });
});

describe('normalizeOptionalDurationSeconds', () => {
  it('returns null for missing or non-positive values', () => {
    assert.equal(normalizeOptionalDurationSeconds(undefined), null);
    assert.equal(normalizeOptionalDurationSeconds(0), null);
    assert.equal(normalizeOptionalDurationSeconds(-5), null);
  });

  it('returns positive durations', () => {
    assert.equal(normalizeOptionalDurationSeconds(120), 120);
  });
});

describe('classifyPlaybackPosition', () => {
  it('clears positions before the minimum save threshold', () => {
    assert.equal(classifyPlaybackPosition(0, 600), 'clear');
    assert.equal(classifyPlaybackPosition(PLAYBACK_POSITION_MIN_SAVE_SECONDS - 0.1, 600), 'clear');
  });

  it('saves mid-video positions', () => {
    assert.equal(classifyPlaybackPosition(120, 600), 'save');
  });

  it('clears near-end positions', () => {
    assert.equal(classifyPlaybackPosition(580, 600), 'clear');
    assert.equal(classifyPlaybackPosition(570, 600), 'clear');
  });

  it('clears positions past duration as finished', () => {
    assert.equal(classifyPlaybackPosition(700, 600), 'clear');
  });

  it('saves without duration metadata', () => {
    assert.equal(classifyPlaybackPosition(45, null), 'save');
  });
});

describe('shouldThrottlePlaybackWrite', () => {
  it('does not throttle forced flushes', () => {
    assert.equal(
      shouldThrottlePlaybackWrite({
        lastUpdatedAt: new Date().toISOString(),
        force: true,
      }),
      false,
    );
  });

  it('throttles recent non-flush writes', () => {
    const now = Date.now();
    assert.equal(
      shouldThrottlePlaybackWrite({
        lastUpdatedAt: new Date(now - 1000).toISOString(),
        nowMs: now,
        force: false,
      }),
      true,
    );
  });

  it('allows writes after the cooldown', () => {
    const now = Date.now();
    assert.equal(
      shouldThrottlePlaybackWrite({
        lastUpdatedAt: new Date(now - 6000).toISOString(),
        nowMs: now,
        force: false,
      }),
      false,
    );
  });
});
