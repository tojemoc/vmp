import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLivestreamStatus } from '../src/livestreams.js'

describe('normalizeLivestreamStatus', () => {
  it('accepts known lifecycle values', () => {
    assert.equal(normalizeLivestreamStatus('provisioning'), 'provisioning')
    assert.equal(normalizeLivestreamStatus('live'), 'live')
    assert.equal(normalizeLivestreamStatus('ended'), 'ended')
    assert.equal(normalizeLivestreamStatus('vod_attached'), 'vod_attached')
  })

  it('normalizes casing and whitespace', () => {
    assert.equal(normalizeLivestreamStatus('  LIVE '), 'live')
    assert.equal(normalizeLivestreamStatus(' Ready'), 'ready')
  })

  it('falls back for unknown values', () => {
    assert.equal(normalizeLivestreamStatus('unknown'), 'draft')
    assert.equal(normalizeLivestreamStatus(null), 'draft')
    assert.equal(normalizeLivestreamStatus(undefined, 'scheduled'), 'scheduled')
  })
})
