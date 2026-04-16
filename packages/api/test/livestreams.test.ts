import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLivestreamStatus } from '../src/livestreams.js'

describe('normalizeLivestreamStatus', () => {
  it('keeps known statuses', () => {
    assert.equal(normalizeLivestreamStatus('draft'), 'draft')
    assert.equal(normalizeLivestreamStatus('provisioning'), 'provisioning')
    assert.equal(normalizeLivestreamStatus('ready'), 'ready')
    assert.equal(normalizeLivestreamStatus('live'), 'live')
    assert.equal(normalizeLivestreamStatus('ended'), 'ended')
    assert.equal(normalizeLivestreamStatus('failed'), 'failed')
  })

  it('normalizes casing and whitespace', () => {
    assert.equal(normalizeLivestreamStatus('  LIVE '), 'live')
  })

  it('returns fallback for unknown statuses', () => {
    assert.equal(normalizeLivestreamStatus('unknown'), 'draft')
    assert.equal(normalizeLivestreamStatus('unknown', 'ended'), 'ended')
    assert.equal(normalizeLivestreamStatus(null, 'draft'), 'draft')
  })

  it('uses custom fallback for non-string statuses', () => {
    assert.equal(normalizeLivestreamStatus(undefined, 'ready'), 'ready')
  })
})
