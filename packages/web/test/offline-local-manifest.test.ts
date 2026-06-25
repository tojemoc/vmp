import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOfflineMasterPlaylist,
  offlineMediaUrl,
  rewritePlaylistForOffline,
} from '../utils/offline/localManifest'

describe('offline localManifest', () => {
  it('builds offline media URLs under the service worker prefix', () => {
    assert.equal(
      offlineMediaUrl('vid-1', '720p/seg.m4s'),
      '/__vmp/offline-media/vid-1/720p/seg.m4s',
    )
  })

  it('rewrites relative segment URIs to offline media URLs', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:6.000,',
      'seg_00001.m4s',
    ].join('\n')

    const output = rewritePlaylistForOffline(input, 'vid-2', '720p/playlist.m3u8')
    assert.match(output, /\/__vmp\/offline-media\/vid-2\/720p\/init\.mp4/)
    assert.match(output, /\/__vmp\/offline-media\/vid-2\/720p\/seg_00001\.m4s/)
  })

  it('builds a master playlist referencing offline variant manifest', () => {
    const master = buildOfflineMasterPlaylist('vid-3', '720p', true)
    assert.match(master, /offline-audio\.m3u8/)
    assert.match(master, /\/__vmp\/offline-media\/vid-3\/720p\/offline-playlist\.m3u8/)
  })
})
