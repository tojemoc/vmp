import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeManifestHash,
  estimateDownloadBytes,
  findAudioPlaylistUrl,
  isOfflineRendition,
  parseLicensedManifestPaths,
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

  it('selects audio playlist matching variant AUDIO group', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-en",NAME="English",URI="audio-en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Main",URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="audio"',
      '720p/playlist.m3u8',
    ].join('\n')
    const url = findAudioPlaylistUrl(master, 'https://cdn.example/videos/vid/master.m3u8', 'audio')
    assert.equal(url, 'https://cdn.example/videos/vid/audio.m3u8')
  })

  it('parses licensed manifest path sets', () => {
    const paths = parseLicensedManifestPaths(JSON.stringify(['720p/seg_720_001.m4s', 'audio.m3u8']))
    assert.ok(paths?.has('720p/seg_720_001.m4s'))
    assert.equal(parseLicensedManifestPaths('not-json'), null)
  })
})
