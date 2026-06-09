/**
 * Queue usage optimizations — push claim helpers and delay computation.
 * Run: npm test --workspace=@vmp/api
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Inline copies of small pure helpers for unit testing without DB mocks.
function computePushDelaySeconds(scheduledAt: unknown) {
  const scheduledMs = Date.parse(String(scheduledAt))
  const now = Date.now()
  if (!Number.isFinite(scheduledMs)) return 0
  if (scheduledMs <= now) return 0
  return Math.max(0, Math.min(86400, Math.floor((scheduledMs - now) / 1000)))
}

function rowCursor(updatedAt: unknown, id: unknown) {
  return `${String(updatedAt ?? '')}|${String(id ?? '')}`
}

describe('computePushDelaySeconds', () => {
  it('returns 0 for past or invalid scheduled_at', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    assert.equal(computePushDelaySeconds(past), 0)
    assert.equal(computePushDelaySeconds('not-a-date'), 0)
  })

  it('caps future delay at 86400 seconds', () => {
    const far = new Date(Date.now() + 200_000_000).toISOString()
    assert.equal(computePushDelaySeconds(far), 86400)
  })
})

describe('replication rowCursor', () => {
  it('encodes updated_at and id for stream cursors', () => {
    assert.equal(rowCursor('2026-06-09T12:00:00Z', 'user-1'), '2026-06-09T12:00:00Z|user-1')
    assert.equal(rowCursor('2026-06-09T12:00:00Z', 'setting-key'), '2026-06-09T12:00:00Z|setting-key')
  })
})
