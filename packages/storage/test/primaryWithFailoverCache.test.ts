import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { PrimaryWithFailoverCache } from '../src/primary-with-failover-cache.js'
import type { ObjectStorageProvider, PrimaryHealthTracker } from '../src/types.js'

function mockProvider(overrides: Partial<ObjectStorageProvider> = {}): ObjectStorageProvider {
  return {
    id: 'mock',
    async getObject() {
      return { body: new Uint8Array() }
    },
    async headObject() {
      return null
    },
    async putObject() {},
    async deleteObject() {},
    async listObjects() {
      return []
    },
    async getSignedReadUrl() {
      return 'https://example.com/signed'
    },
    async getSignedWriteUrl() {
      return 'https://example.com/write'
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
      id: 'primary',
      async getObject() {
        return { body: new Uint8Array([1]), contentType: 'video/mp4' }
      },
    })
    const cache = mockProvider({
      id: 'cache',
      async getObject() {
        throw new Error('cache should not be called')
      },
    })
    const storage = new PrimaryWithFailoverCache(primary, cache, mockHealth())
    const result = await storage.getObject('videos/vid/seg.m4s')
    assert.ok(result)
    assert.equal(result.contentType, 'video/mp4')
  })

  it('fails over to cache when primary throws availability error', async () => {
    const primary = mockProvider({
      id: 'primary',
      async getObject() {
        const err = new Error('Service Unavailable') as Error & { $metadata?: { httpStatusCode: number } }
        err.$metadata = { httpStatusCode: 503 }
        throw err
      },
    })
    let cacheCalled = false
    const cache = mockProvider({
      id: 'cache',
      async getObject() {
        cacheCalled = true
        return { body: new Uint8Array([2]) }
      },
    })
    const recordFailure = mock.fn(async () => {})
    const storage = new PrimaryWithFailoverCache(primary, cache, mockHealth({ recordFailure }))
    await storage.getObject('videos/vid/seg.m4s')
    assert.equal(cacheCalled, true)
    assert.equal(recordFailure.mock.calls.length, 1)
  })

  it('does not fail over on genuine 404 from primary', async () => {
    const primary = mockProvider({
      id: 'primary',
      async getObject() {
        return null
      },
    })
    const cache = mockProvider({
      id: 'cache',
      async getObject() {
        throw new Error('cache should not be called')
      },
    })
    const storage = new PrimaryWithFailoverCache(primary, cache, mockHealth())
    const result = await storage.getObject('videos/old/master.m3u8')
    assert.equal(result, null)
  })

  it('reads cache when primary is unhealthy without calling primary', async () => {
    let primaryCalled = false
    const primary = mockProvider({
      id: 'primary',
      async getObject() {
        primaryCalled = true
        return { body: new Uint8Array([1]) }
      },
    })
    let cacheCalled = false
    const cache = mockProvider({
      id: 'cache',
      async getObject() {
        cacheCalled = true
        return { body: new Uint8Array([2]) }
      },
    })
    const storage = new PrimaryWithFailoverCache(primary, cache, mockHealth({
      async isHealthy() {
        return false
      },
    }))
    await storage.getObject('videos/vid/seg.m4s')
    assert.equal(primaryCalled, false)
    assert.equal(cacheCalled, true)
  })
})
