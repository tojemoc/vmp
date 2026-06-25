import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CHUNK_RELOAD_ATTEMPTED_AT_KEY,
  CHUNK_RELOAD_THROTTLE_MS,
  isChunkLoadErrorReason,
  isNuxtAssetUrl,
  shouldAttemptChunkReload,
} from '../utils/chunkLoadRecovery'

function storageWith(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) {
    values.set(CHUNK_RELOAD_ATTEMPTED_AT_KEY, initial)
  }

  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

describe('isChunkLoadErrorReason', () => {
  it('matches Safari module script import failures', () => {
    assert.equal(isChunkLoadErrorReason(new TypeError('Importing a module script failed.')), true)
  })

  it('matches Chromium dynamic import fetch failures', () => {
    assert.equal(
      isChunkLoadErrorReason(new TypeError('Failed to fetch dynamically imported module: /_nuxt/watch.abc.js')),
      true,
    )
  })

  it('does not match unrelated promise rejections', () => {
    assert.equal(isChunkLoadErrorReason(new TypeError('Cannot read properties of undefined')), false)
  })

  it('matches transient 503 asset failures', () => {
    assert.equal(isChunkLoadErrorReason(new TypeError('Failed to fetch /_nuxt/app.abc.js: 503 Service Unavailable')), true)
  })
})

describe('isNuxtAssetUrl', () => {
  it('matches /_nuxt chunk paths', () => {
    assert.equal(isNuxtAssetUrl('https://vmp.tjm.sk/_nuxt/entry.js'), true)
  })

  it('matches service worker and workbox assets', () => {
    assert.equal(isNuxtAssetUrl('https://vmp.tjm.sk/sw.js'), true)
    assert.equal(isNuxtAssetUrl('https://vmp.tjm.sk/workbox-abc123.js'), true)
    assert.equal(isNuxtAssetUrl('https://vmp.tjm.sk/_workbox-abc123.js'), true)
  })

  it('ignores unrelated URLs', () => {
    assert.equal(isNuxtAssetUrl('https://vmp-api.tjm.sk/api/health'), false)
  })
})

describe('shouldAttemptChunkReload', () => {
  it('allows the first reload attempt and records the attempt time', () => {
    const storage = storageWith()

    assert.equal(shouldAttemptChunkReload(storage, 1_000), true)
    assert.equal(storage.values.get(CHUNK_RELOAD_ATTEMPTED_AT_KEY), '1000')
  })

  it('blocks reload loops within the throttle window', () => {
    const storage = storageWith('1000')

    assert.equal(shouldAttemptChunkReload(storage, 1_000 + CHUNK_RELOAD_THROTTLE_MS - 1), false)
  })

  it('allows a later reload attempt after the throttle window', () => {
    const storage = storageWith('1000')

    assert.equal(shouldAttemptChunkReload(storage, 1_000 + CHUNK_RELOAD_THROTTLE_MS), true)
  })

  it('throttles reload attempts when storage operations throw or storage is unavailable', () => {
    const blockedStorage = {
      getItem() {
        throw new Error('storage unavailable')
      },
      setItem() {
        throw new Error('storage unavailable')
      },
    }
    const now = 1_000_000

    assert.equal(shouldAttemptChunkReload(blockedStorage, now), true)
    assert.equal(shouldAttemptChunkReload(blockedStorage, now + CHUNK_RELOAD_THROTTLE_MS - 1), false)
    assert.equal(shouldAttemptChunkReload(null, now + CHUNK_RELOAD_THROTTLE_MS), true)
    assert.equal(shouldAttemptChunkReload(null, now + (CHUNK_RELOAD_THROTTLE_MS * 2) - 1), false)
  })
})
