import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getPlaybackEndClearThresholds,
  getPlaybackSaveIntervalMs,
  isNearPlaybackEnd,
  normalizeClientCapturedAtMs,
  PLAYBACK_POSITION_MIN_SAVE_SECONDS,
  shouldRejectStalePlaybackWrite,
} from '../src/playbackPosition.js';

describe('getPlaybackEndClearThresholds', () => {
  it('uses proportional tail for short-form content', () => {
    const thresholds = getPlaybackEndClearThresholds(180);
    assert.equal(thresholds.epsilonSeconds, 27);
    assert.ok(thresholds.endFraction < 0.9);
  });

  it('keeps long-form absolute tail and 95% fraction', () => {
    const thresholds = getPlaybackEndClearThresholds(3600);
    assert.equal(thresholds.epsilonSeconds, 30);
    assert.equal(thresholds.endFraction, 0.95);
  });
});

describe('isNearPlaybackEnd', () => {
  it('does not treat 2:30 on a 3-minute clip as finished', () => {
    assert.equal(isNearPlaybackEnd(150, 180), false);
  });

  it('clears within the short-form proportional tail', () => {
    assert.equal(isNearPlaybackEnd(154, 180), true);
  });

  it('clears within 30 seconds on long-form content', () => {
    assert.equal(isNearPlaybackEnd(580, 600), true);
  });
});

describe('getPlaybackSaveIntervalMs', () => {
  it('uses shorter intervals for short clips', () => {
    const short = getPlaybackSaveIntervalMs(120);
    const long = getPlaybackSaveIntervalMs(3600);
    assert.ok(short < long);
    assert.ok(short <= 15_000);
  });
});

describe('normalizeClientCapturedAtMs', () => {
  it('clamps timestamps far in the future', () => {
    const serverNowMs = 1_000_000;
    assert.equal(normalizeClientCapturedAtMs(serverNowMs + 60 * 60 * 1000, serverNowMs), serverNowMs);
  });
});

describe('shouldRejectStalePlaybackWrite', () => {
  it('allows recovery when stored timestamp is far in the future', () => {
    const serverNowMs = 1_000_000;
    assert.equal(
      shouldRejectStalePlaybackWrite({
        existingCapturedAtMs: serverNowMs + 60 * 60 * 1000,
        incomingCapturedAtMs: serverNowMs + 1000,
        serverNowMs,
      }),
      false,
    );
  });

  it('rejects older incoming timestamps under normal clock conditions', () => {
    assert.equal(
      shouldRejectStalePlaybackWrite({
        existingCapturedAtMs: 2000,
        incomingCapturedAtMs: 1000,
        serverNowMs: 2500,
      }),
      true,
    );
  });
});

describe('PLAYBACK_POSITION_MIN_SAVE_SECONDS', () => {
  it('is exported for API and web parity', () => {
    assert.equal(PLAYBACK_POSITION_MIN_SAVE_SECONDS, 5);
  });
});
