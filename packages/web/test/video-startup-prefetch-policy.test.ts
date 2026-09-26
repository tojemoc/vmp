import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANON_STARTUP_PREFETCH_BUDGET,
  DEFAULT_STARTUP_SEGMENT_COUNT,
} from '../composables/useVideoStartupPrefetch';

describe('video startup prefetch policy', () => {
  it('allows anonymous warmup comparable to logged-in eager queue size', () => {
    // Prefetch no longer burns rate_limit_anon (watch-only header).
    assert.equal(ANON_STARTUP_PREFETCH_BUDGET, 12);
    assert.ok(ANON_STARTUP_PREFETCH_BUDGET >= 8);
  });

  it('warms more than a single segment for startup', () => {
    assert.ok(DEFAULT_STARTUP_SEGMENT_COUNT >= 2);
  });
});
