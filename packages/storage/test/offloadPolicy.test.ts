import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AgeBasedOffloadPolicy } from '../src/offloadPolicy.js'
import type { ObjectMetadata } from '../src/types.js'

describe('AgeBasedOffloadPolicy', () => {
  it('offloads objects older than maxHotAgeSeconds', () => {
    const policy = new AgeBasedOffloadPolicy(3600)
    const old: ObjectMetadata = {
      key: 'videos/a/seg.m4s',
      size: 100,
      lastModified: new Date(Date.now() - 7200_000),
    }
    const recent: ObjectMetadata = {
      key: 'videos/b/seg.m4s',
      size: 100,
      lastModified: new Date(),
    }
    assert.equal(policy.shouldOffload(old), true)
    assert.equal(policy.shouldOffload(recent), false)
  })
})
