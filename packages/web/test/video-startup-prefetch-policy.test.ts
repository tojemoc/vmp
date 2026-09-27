import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANON_STARTUP_PREFETCH_BUDGET,
  DEFAULT_STARTUP_SEGMENT_COUNT,
} from '../composables/useVideoStartupPrefetch';

describe('video startup prefetch policy', () => {
  it('disables anonymous catalog HLS warmup (playable access is watch-only)', () => {
    assert.equal(ANON_STARTUP_PREFETCH_BUDGET, 0);
  });

  it('warms more than a single segment for startup', () => {
    assert.ok(DEFAULT_STARTUP_SEGMENT_COUNT >= 2);
  });
});
