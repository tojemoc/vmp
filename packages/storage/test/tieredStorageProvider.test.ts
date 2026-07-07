import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TieredStorageProvider } from '../src/tieredStorageProvider.js'
import type { ObjectMetadata, ObjectStorageProvider } from '../src/types.js'

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

describe('TieredStorageProvider', () => {
  it('read-through falls back to cold on hot miss', async () => {
    const hot = mockProvider({
      id: 'hot',
      async getObject() {
        return null
      },
    })
    let coldCalled = false
    const cold = mockProvider({
      id: 'cold',
      async getObject() {
        coldCalled = true
        return { body: new Uint8Array([1]) }
      },
    })
    const tiered = new TieredStorageProvider(hot, cold)
    await tiered.getObject('videos/a/seg.m4s')
    assert.equal(coldCalled, true)
  })

  it('writes only to hot', async () => {
    let hotPut = false
    const hot = mockProvider({
      id: 'hot',
      async putObject() {
        hotPut = true
      },
    })
    const cold = mockProvider({
      id: 'cold',
      async putObject() {
        throw new Error('cold should not receive writes')
      },
    })
    const tiered = new TieredStorageProvider(hot, cold)
    await tiered.putObject('videos/a/seg.m4s', new Uint8Array([1]))
    assert.equal(hotPut, true)
  })

  it('dedupes listObjects with hot precedence', async () => {
    const hotList: ObjectMetadata[] = [{ key: 'videos/a/seg.m4s', size: 1 }]
    const coldList: ObjectMetadata[] = [
      { key: 'videos/a/seg.m4s', size: 99 },
      { key: 'videos/b/seg.m4s', size: 2 },
    ]
    const tiered = new TieredStorageProvider(
      mockProvider({ id: 'hot', async listObjects() { return hotList } }),
      mockProvider({ id: 'cold', async listObjects() { return coldList } }),
    )
    const listed = await tiered.listObjects('videos/')
    assert.equal(listed.length, 2)
    assert.equal(listed.find((e) => e.key === 'videos/a/seg.m4s')?.size, 1)
  })
})
