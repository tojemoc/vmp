import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import {
  checkPlaylistAvailability,
  isPlaybackUnavailableCode,
  isPlaybackUnavailableError,
  parseProxyErrorCode,
  PlaybackUnavailableError,
} from '../utils/playlistAvailability'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restoreAll()
})

describe('parseProxyErrorCode', () => {
  it('reads string code from JSON bodies', () => {
    assert.equal(parseProxyErrorCode({ code: 'storage_unavailable' }), 'storage_unavailable')
    assert.equal(parseProxyErrorCode({ code: 404 }), null)
    assert.equal(parseProxyErrorCode(null), null)
  })
})

describe('isPlaybackUnavailableCode', () => {
  it('accepts known unavailable codes only', () => {
    assert.equal(isPlaybackUnavailableCode('storage_unavailable'), true)
    assert.equal(isPlaybackUnavailableCode('media_not_available'), true)
    assert.equal(isPlaybackUnavailableCode('unknown'), false)
  })
})

describe('checkPlaylistAvailability', () => {
  it('returns ok for successful manifest fetch', async () => {
    globalThis.fetch = mock.fn(async () => new Response('#EXTM3U', { status: 200 })) as typeof fetch
    const result = await checkPlaylistAvailability('https://example.test/master.m3u8')
    assert.deepEqual(result, { ok: true })
  })

  it('classifies storage_unavailable from JSON code and 502 fallback', async () => {
    globalThis.fetch = mock.fn(async () =>
      Response.json({ code: 'storage_unavailable' }, { status: 502 }),
    ) as typeof fetch
    const result = await checkPlaylistAvailability('https://example.test/master.m3u8')
    assert.deepEqual(result, { ok: false, code: 'storage_unavailable' })
  })

  it('classifies media_not_available from JSON code and 404 fallback', async () => {
    globalThis.fetch = mock.fn(async () =>
      Response.json({ code: 'media_not_available' }, { status: 404 }),
    ) as typeof fetch
    const result = await checkPlaylistAvailability('https://example.test/master.m3u8')
    assert.deepEqual(result, { ok: false, code: 'media_not_available' })
  })

  it('re-throws route AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => checkPlaylistAvailability('https://example.test/master.m3u8', controller.signal),
      (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
    )
  })

  it('classifies network failures as storage_unavailable', async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const result = await checkPlaylistAvailability('https://example.test/master.m3u8')
    assert.deepEqual(result, { ok: false, code: 'storage_unavailable' })
  })

  it('classifies unknown HTTP errors explicitly', async () => {
    globalThis.fetch = mock.fn(async () => new Response('nope', { status: 500 })) as typeof fetch
    const result = await checkPlaylistAvailability('https://example.test/master.m3u8')
    assert.deepEqual(result, { ok: false, code: 'unknown' })
  })
})

describe('PlaybackUnavailableError', () => {
  it('is detected by isPlaybackUnavailableError', () => {
    const err = new PlaybackUnavailableError()
    assert.equal(isPlaybackUnavailableError(err), true)
    assert.equal(isPlaybackUnavailableError(new Error('other')), false)
  })
})
