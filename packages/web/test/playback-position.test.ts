import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  shouldResumePlaybackPosition,
  shouldSavePlaybackPosition,
} from '../composables/usePlaybackPosition';

describe('shouldResumePlaybackPosition', () => {
  it('resumes mid-video positions', () => {
    assert.equal(shouldResumePlaybackPosition(120, 600), true);
  });

  it('skips near-start and near-end', () => {
    assert.equal(shouldResumePlaybackPosition(2, 600), false);
    assert.equal(shouldResumePlaybackPosition(590, 600), false);
    assert.equal(shouldResumePlaybackPosition(null, 600), false);
  });
});

describe('shouldSavePlaybackPosition', () => {
  it('blocks periodic saves while scrubbing', () => {
    assert.equal(
      shouldSavePlaybackPosition({
        positionSeconds: 100,
        durationSeconds: 600,
        isSeeking: true,
        reason: 'periodic',
        activelyWatching: true,
      }),
      false,
    );
  });

  it('allows flush even while seeking', () => {
    assert.equal(
      shouldSavePlaybackPosition({
        positionSeconds: 100,
        durationSeconds: 600,
        isSeeking: true,
        reason: 'flush',
        activelyWatching: false,
      }),
      true,
    );
  });

  it('requires active watch for periodic saves', () => {
    assert.equal(
      shouldSavePlaybackPosition({
        positionSeconds: 100,
        durationSeconds: 600,
        isSeeking: false,
        reason: 'periodic',
        activelyWatching: false,
      }),
      false,
    );
  });

  it('saves periodic mid-video watches', () => {
    assert.equal(
      shouldSavePlaybackPosition({
        positionSeconds: 100,
        durationSeconds: 600,
        isSeeking: false,
        reason: 'periodic',
        activelyWatching: true,
      }),
      true,
    );
  });
});
