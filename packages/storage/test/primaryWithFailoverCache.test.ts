import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  PrimaryWithFailoverCache,
  StorageAvailabilityError,
  StorageNotFoundError,
} from '../src/index.js'
import type { ObjectStorageProvider, PrimaryHealthTracker } from '../src/index.js'

function mockProvider(overrides: Partial<ObjectStorageProvider> = {}): ObjectStorageProvider {
  return {
    async getObject() {
      return { status: 200, headers: new Headers(), body: null }
    },
    async headObject() {
      return null
    },
    async putObject() {},
    async deleteObject() {},
    async listObjects() {
      return []
    },
    ...overrides,
  }
}

function mockHealth(overrides: Partial<PrimaryHealthTracker> = {}): PrimaryHealthTracker {
  return {
    async isHealthy() {
      return true
    },
    async recordFailure() {},
    async recordSuccess() {},
    ...overrides,
  }
}

describe('PrimaryWithFailoverCache', () => {
  it('returns primary bytes when healthy', async () => {
    const primary = mockProvider({
      async getObject(key) {
        return {
          status: 200,
          headers: new Headers({ 'Content-Type': 'video/mp4' }),
          body: null,
        }
      },
    })
    const cache = mockProvider({
      async getObject() {
        throw new Error('cache should not be called')
      },
    })
    const health = mockHealth()
    const storage = new PrimaryWithFailoverCache(primary, cache, health)
    const result = await storage.getObject('videos/vid/seg.m4s')
    assert.equal(result.status, 200)
  })

  it('fails over to cache when primary throws availability error', async () => {
    const primary = mockProvider({
      async getObject() {
        throw new StorageAvailabilityError('videos/vid/seg.m4s', '503', 503)
      },
    })
    let cacheCalled = false
    const cache = mockProvider({
      async getObject(key) {
        cacheCalled = true
        return { status: 200, headers: new Headers(), body: null }
      },
    })
    const recordFailure = mock.fn(async () => {})
    const health = mockHealth({ recordFailure })
    const storage = new PrimaryWithFailoverCache(primary, cache, health)
    await storage.getObject('videos/vid/seg.m4s')
    assert.equal(cacheCalled, true)
    assert.equal(recordFailure.mock.calls.length, 1)
  })

  it('does not fail over on genuine 404 from primary', async () => {
    const primary = mockProvider({
      async getObject() {
        throw new StorageNotFoundError('videos/old/master.m3u8')
      },
    })
    const cache = mockProvider({
      async getObject() {
        throw new Error('cache should not be called')
      },
    })
    const storage = new PrimaryWithFailoverCache(primary, cache, mockHealth())
    await assert.rejects(
      () => storage.getObject('videos/old/master.m3u8'),
      StorageNotFoundError,
    )
  })

  it('reads cache when primary is unhealthy without calling primary', async () => {
    let primaryCalled = false
    const primary = mockProvider({
      async getObject() {
        primaryCalled = true
        return { status: 200, headers: new Headers(), body: null }
      },
    })
    let cacheCalled = false
    const cache = mockProvider({
      async getObject() {
        cacheCalled = true
        return { status: 200, headers: new Headers(), body: null }
      },
    })
    const health = mockHealth({
      async isHealthy() {
        return false
      },
    })
    const storage = new PrimaryWithFailoverCache(primary, cache, health)
    await storage.getObject('videos/vid/seg.m4s')
    assert.equal(primaryCalled, false)
    assert.equal(cacheCalled, true)
  })
})
