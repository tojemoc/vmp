/**
 * Queue usage optimizations — push claim helpers and delay computation.
 * Run: npm test --workspace=@vmp/api
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePushDelaySeconds } from '../src/pushEngagement.js';
import { rowCursor } from '../src/replication.js';

describe('computePushDelaySeconds', () => {
  it('returns 0 for past or invalid scheduled_at', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    assert.equal(computePushDelaySeconds(past), 0);
    assert.equal(computePushDelaySeconds('not-a-date'), 0);
  });

  it('caps future delay at 86400 seconds', () => {
    const far = new Date(Date.now() + 200_000_000).toISOString();
    assert.equal(computePushDelaySeconds(far), 86400);
  });
});

describe('replication rowCursor', () => {
  it('encodes updated_at and id for stream cursors', () => {
    assert.equal(rowCursor('2026-06-09T12:00:00Z', 'user-1'), '2026-06-09T12:00:00Z|user-1');
    assert.equal(
      rowCursor('2026-06-09T12:00:00Z', 'setting-key'),
      '2026-06-09T12:00:00Z|setting-key',
    );
  });
});
