import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  buildEntrypointCandidates,
  getVideoProxyCacheControl,
  resolveMediaEntrypoint,
  resolveMediaEntrypointUrl,
  sortMasterPlaylistByBandwidth,
} from '../src/mediaEntrypoints.js';
import { isImmutableVideoProxyObject, videoProxyObjectCacheKey } from '../src/videoProxyCache.js';

describe('buildEntrypointCandidates', () => {
  it('keeps HLS-first order by default', () => {
    const base = 'https://cdn.example.com';
    const videoId = 'vid_123';
    assert.deepEqual(buildEntrypointCandidates(base, videoId), [
      'https://cdn.example.com/videos/vid_123/master.m3u8',
      'https://cdn.example.com/videos/vid_123/processed/hls/master.m3u8',
      'https://cdn.example.com/videos/vid_123/processed/playlist.m3u8',
    ]);
  });

  it('adds podcast candidates first when preferPodcast is enabled', () => {
    const base = 'https://cdn.example.com';
    const videoId = 'vid_123';
    assert.deepEqual(buildEntrypointCandidates(base, videoId, { preferPodcast: true }), [
      'https://cdn.example.com/videos/vid_123/podcast.mp3',
      'https://cdn.example.com/videos/vid_123/processed/podcast.mp3',
      'https://cdn.example.com/videos/vid_123/processed/audio/podcast.mp3',
      'https://cdn.example.com/videos/vid_123/master.m3u8',
      'https://cdn.example.com/videos/vid_123/processed/hls/master.m3u8',
      'https://cdn.example.com/videos/vid_123/processed/playlist.m3u8',
    ]);
  });

  it('prefers preview MP3 then HLS when rssPreview is enabled', () => {
    const base = 'https://cdn.example.com';
    const videoId = 'vid_123';
    assert.deepEqual(
      buildEntrypointCandidates(base, videoId, { preferPodcast: true, rssPreview: true }),
      [
        'https://cdn.example.com/videos/vid_123/podcast_preview.mp3',
        'https://cdn.example.com/videos/vid_123/processed/podcast_preview.mp3',
        'https://cdn.example.com/videos/vid_123/master.m3u8',
        'https://cdn.example.com/videos/vid_123/processed/hls/master.m3u8',
        'https://cdn.example.com/videos/vid_123/processed/playlist.m3u8',
      ],
    );
  });
});

describe('resolveMediaEntrypoint mediaFound', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('sets mediaFound when an R2 HEAD succeeds', async () => {
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/processed/hls/master.m3u8')) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const resolved = await resolveMediaEntrypoint({
      env: { R2_BASE_URL: 'https://cdn.example.com' },
      videoId: 'vid_123',
    });
    assert.equal(resolved.mediaFound, true);
    assert.equal(resolved.url, 'https://cdn.example.com/videos/vid_123/processed/hls/master.m3u8');
  });

  it('sets mediaFound when Bunny fallback is selected', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));

    const bunny = 'https://vz.example.com/play_123/playlist.m3u8';
    const resolved = await resolveMediaEntrypoint({
      env: { R2_BASE_URL: 'https://cdn.example.com' },
      videoId: 'vid_123',
      bunnyPlaybackUrl: bunny,
    });
    assert.equal(resolved.mediaFound, true);
    assert.equal(resolved.url, bunny);
  });

  it('returns mediaFound false when nothing is found, and URL wrapper still works', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));

    const resolved = await resolveMediaEntrypoint({
      env: { R2_BASE_URL: 'https://cdn.example.com' },
      videoId: 'vid_123',
    });
    assert.equal(resolved.mediaFound, false);
    assert.equal(resolved.url, 'https://cdn.example.com/videos/vid_123/master.m3u8');

    const urlOnly = await resolveMediaEntrypointUrl({
      env: { R2_BASE_URL: 'https://cdn.example.com' },
      videoId: 'vid_123',
    });
    assert.equal(urlOnly, resolved.url);
  });
});

describe('getVideoProxyCacheControl', () => {
  it('returns short-lived cache for HLS playlists', () => {
    assert.equal(
      getVideoProxyCacheControl('videos/vid_123/master.m3u8', 'hls'),
      'public, max-age=60, s-maxage=60',
    );
  });

  it('returns immutable cache for CMAF segments', () => {
    assert.equal(
      getVideoProxyCacheControl('videos/vid_123/seg_1080_1.m4s', null),
      'public, max-age=31536000, immutable',
    );
  });

  it('returns immutable cache for CMAF init segments', () => {
    assert.equal(
      getVideoProxyCacheControl('videos/vid_123/init_1080.mp4', null),
      'public, max-age=31536000, immutable',
    );
  });

  it('returns null for non-HLS assets', () => {
    assert.equal(getVideoProxyCacheControl('videos/vid_123/poster.jpg', null), null);
  });
});

describe('sortMasterPlaylistByBandwidth', () => {
  it('orders STREAM-INF pairs ascending by BANDWIDTH', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8",GROUP-ID="a"',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="a"',
      'stream_hi.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,AUDIO="a"',
      'stream_lo.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="a"',
      'stream_mid.m3u8',
    ].join('\n');

    const sorted = sortMasterPlaylistByBandwidth(input);
    const lines = sorted.split('\n');
    assert.equal(lines[0], '#EXTM3U');
    assert.match(lines[1]!, /EXT-X-MEDIA/);
    assert.match(lines[2]!, /BANDWIDTH=800000/);
    assert.equal(lines[3], 'stream_lo.m3u8');
    assert.match(lines[4]!, /BANDWIDTH=2000000/);
    assert.equal(lines[5], 'stream_mid.m3u8');
    assert.match(lines[6]!, /BANDWIDTH=5000000/);
    assert.equal(lines[7], 'stream_hi.m3u8');
  });

  it('uses BANDWIDTH not AVERAGE-BANDWIDTH when both are present', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=4500000,BANDWIDTH=800000,RESOLUTION=854x480',
      'stream_lo.m3u8',
      '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=900000,BANDWIDTH=5000000,RESOLUTION=1920x1080',
      'stream_hi.m3u8',
    ].join('\n');

    const sorted = sortMasterPlaylistByBandwidth(input);
    const lines = sorted.split('\n');
    assert.match(lines[1]!, /BANDWIDTH=800000/);
    assert.equal(lines[2], 'stream_lo.m3u8');
    assert.match(lines[3]!, /BANDWIDTH=5000000/);
    assert.equal(lines[4], 'stream_hi.m3u8');
  });
});

describe('videoProxyCache keys', () => {
  it('treats m4s and init as immutable', () => {
    assert.equal(isImmutableVideoProxyObject('videos/x/seg_1.m4s'), true);
    assert.equal(isImmutableVideoProxyObject('videos/x/init_audio.mp4'), true);
    assert.equal(isImmutableVideoProxyObject('videos/x/master.m3u8'), false);
  });

  it('builds path-only cache keys without query strings', () => {
    const key = videoProxyObjectCacheKey('videos/abc/seg_1.m4s');
    assert.equal(new URL(key.url).pathname, '/videos/abc/seg_1.m4s');
    assert.equal(new URL(key.url).search, '');
  });
});
