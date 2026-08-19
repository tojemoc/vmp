import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimActivePlayerVideoIdForFlush } from '../utils/playbackRouteFlush';

describe('claimActivePlayerVideoIdForFlush', () => {
  it('claims and clears the active player video id', () => {
    const state = { value: 'video-a' as string | null };
    assert.equal(claimActivePlayerVideoIdForFlush(state), 'video-a');
    assert.equal(state.value, null);
  });

  it('returns null when no video was actively playing', () => {
    const state = { value: null as string | null };
    assert.equal(claimActivePlayerVideoIdForFlush(state), null);
    assert.equal(state.value, null);
  });

  it('supports rapid A → B → C navigation without flushing stale route params', () => {
    const state = { value: 'video-a' as string | null };

    assert.equal(claimActivePlayerVideoIdForFlush(state), 'video-a');
    assert.equal(state.value, null);

    // B never finished loading; route watcher would have passed oldVideoId=B.
    assert.equal(claimActivePlayerVideoIdForFlush(state), null);

    state.value = 'video-c';
    assert.equal(claimActivePlayerVideoIdForFlush(state), 'video-c');
    assert.equal(state.value, null);
  });
});
