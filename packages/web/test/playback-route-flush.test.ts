import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assignActivePlayerVideoIdIfCurrent,
  claimActivePlayerVideoIdForFlush,
} from '../utils/playbackRouteFlush';

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

describe('assignActivePlayerVideoIdIfCurrent', () => {
  it('assigns only when the invocation is still current', () => {
    const state = { value: null as string | null };
    assignActivePlayerVideoIdIfCurrent(state, 'video-b', () => false);
    assert.equal(state.value, null);

    assignActivePlayerVideoIdIfCurrent(state, 'video-c', () => true);
    assert.equal(state.value, 'video-c');
  });

  it('does not let stale B claim overwrite C during A→B→C while B is initializing', () => {
    const state = { value: 'video-a' as string | null };
    const flushed: string[] = [];

    // Leave A for B.
    const flushedA = claimActivePlayerVideoIdForFlush(state);
    assert.equal(flushedA, 'video-a');
    if (flushedA) flushed.push(flushedA);

    // B starts initializeVideoElement but is superseded by C before it finishes.
    let currentRoute = 'video-c';
    const isBCurrent = () => currentRoute === 'video-b';
    const isCCurrent = () => currentRoute === 'video-c';

    // Leave B for C before B claims.
    const flushedB = claimActivePlayerVideoIdForFlush(state);
    assert.equal(flushedB, null);

    // Stale B init completes and must not claim.
    assignActivePlayerVideoIdIfCurrent(state, 'video-b', isBCurrent);
    assert.equal(state.value, null);

    // C finishes init and claims.
    assignActivePlayerVideoIdIfCurrent(state, 'video-c', isCCurrent);
    assert.equal(state.value, 'video-c');

    // Position flush on leave must target C, not B.
    const flushedC = claimActivePlayerVideoIdForFlush(state);
    assert.equal(flushedC, 'video-c');
    if (flushedC) flushed.push(flushedC);
    assert.deepEqual(flushed, ['video-a', 'video-c']);
  });
});
