import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeManifestHash,
  estimateDownloadBytes,
  isOfflineRendition,
  sha256HexFromString,
} from '../src/offlineManifest.js'

describe('offlineManifest helpers', () => {
  it('validates rendition keys', () => {
    assert.equal(isOfflineRendition('720p'), true)
    assert.equal(isOfflineRendition('4k'), false)
  })

  it('computes stable manifest hashes', async () => {
    const files = [
      { path: '720p/seg_720_001.m4s', size: 100 },
      { path: 'audio/seg_audio_001.m4s', size: 50 },
    ]
    const hashA = await sha256HexFromString(computeManifestHash(files))
    const hashB = await sha256HexFromString(computeManifestHash([...files].reverse()))
    assert.equal(hashA, hashB)
    assert.match(hashA, /^[0-9a-f]{64}$/)
  })

  it('estimates download size from duration and rendition', () => {
    const bytes = estimateDownloadBytes(3600, '720p')
    assert.ok(bytes > 1_000_000_000)
    assert.ok(bytes < 2_500_000_000)
  })
})
