import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TieredStorageProvider, StorageNotFoundError } from '../src/index.js'
import type { ListedObject, ObjectStorageProvider } from '../src/index.js'

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

describe('TieredStorageProvider', () => {
  it('read-through falls back to cold on hot miss', async () => {
    const hot = mockProvider({
      async getObject() {
        throw new StorageNotFoundError('videos/a/seg.m4s')
      },
    })
    let coldCalled = false
    const cold = mockProvider({
      async getObject(key) {
        coldCalled = true
        return { status: 200, headers: new Headers(), body: null }
      },
    })
    const tiered = new TieredStorageProvider(hot, cold)
    await tiered.getObject('videos/a/seg.m4s')
    assert.equal(coldCalled, true)
  })

  it('writes only to hot', async () => {
    let hotPut = false
    const hot = mockProvider({
      async putObject() {
        hotPut = true
      },
    })
    const cold = mockProvider({
      async putObject() {
        throw new Error('cold should not receive writes')
      },
    })
    const tiered = new TieredStorageProvider(hot, cold)
    await tiered.putObject('videos/a/seg.m4s', new Uint8Array([1]))
    assert.equal(hotPut, true)
  })

  it('dedupes listObjects with hot precedence', async () => {
    const hotList: ListedObject[] = [{ key: 'videos/a/seg.m4s', size: 1 }]
    const coldList: ListedObject[] = [
      { key: 'videos/a/seg.m4s', size: 99 },
      { key: 'videos/b/seg.m4s', size: 2 },
    ]
    const tiered = new TieredStorageProvider(
      mockProvider({ async listObjects() { return hotList } }),
      mockProvider({ async listObjects() { return coldList } }),
    )
    const listed = await tiered.listObjects('videos/')
    assert.equal(listed.length, 2)
    assert.equal(listed.find((e) => e.key === 'videos/a/seg.m4s')?.size, 1)
  })
})
