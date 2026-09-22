import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterPubliclyListedVideos, isPubliclyListedVideo } from '../src/catalog/publishedVideos';
import {
  isLikelyNetworkError,
  OFFLINE_MODE_MESSAGE,
  userFacingRequestError,
} from '../src/network/errors';
import { buildOfflinePlaybackHttpUrl, fileUriToFsPath } from '../src/offline/playbackUrls';

describe('isPubliclyListedVideo', () => {
  const now = Date.parse('2026-09-22T12:00:00Z');

  it('keeps published videos without a future schedule', () => {
    assert.equal(isPubliclyListedVideo({ id: 'a', publish_status: 'published' }, now), true);
    assert.equal(
      isPubliclyListedVideo(
        { id: 'b', publish_status: 'published', scheduled_publish_at: '2026-09-20T00:00:00Z' },
        now,
      ),
      true,
    );
  });

  it('hides drafts, archived, and future-scheduled publishes', () => {
    assert.equal(isPubliclyListedVideo({ id: 'd', publish_status: 'draft' }, now), false);
    assert.equal(isPubliclyListedVideo({ id: 'x', publish_status: 'archived' }, now), false);
    assert.equal(isPubliclyListedVideo({ id: 'n', publish_status: null }, now), false);
    assert.equal(
      isPubliclyListedVideo(
        { id: 's', publish_status: 'published', scheduled_publish_at: '2026-09-30T00:00:00Z' },
        now,
      ),
      false,
    );
  });

  it('filters catalog arrays', () => {
    const rows = filterPubliclyListedVideos(
      [
        { id: '1', publish_status: 'published' },
        { id: '2', publish_status: 'draft' },
        { id: '3', publish_status: 'published', scheduled_publish_at: '2099-01-01T00:00:00Z' },
      ],
      now,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['1'],
    );
  });
});

describe('network error helpers', () => {
  it('detects common React Native / fetch offline failures', () => {
    assert.equal(isLikelyNetworkError(new TypeError('Network request failed')), true);
    assert.equal(isLikelyNetworkError(new Error('Failed to fetch')), true);
    assert.equal(isLikelyNetworkError(new Error('timeout')), true);
    assert.equal(isLikelyNetworkError(new Error('Invalid token')), false);
  });

  it('maps network errors to offline mode copy and hides other Error.message', () => {
    assert.equal(
      userFacingRequestError(new TypeError('Network request failed')),
      OFFLINE_MODE_MESSAGE,
    );
    assert.equal(userFacingRequestError(new Error('boom'), 'fallback'), 'fallback');
    assert.equal(
      userFacingRequestError(new Error('Internal stack'), 'Failed to load videos'),
      'Failed to load videos',
    );
  });
});

describe('offline playback server URL helpers', () => {
  it('strips file:// from expo document URIs', () => {
    assert.equal(
      fileUriToFsPath('file:///var/mobile/Containers/Data/Application/x/Documents/vmp-offline/'),
      '/var/mobile/Containers/Data/Application/x/Documents/vmp-offline/',
    );
    assert.equal(fileUriToFsPath('file:///tmp/vmp%20offline/'), '/tmp/vmp offline/');
  });

  it('builds loopback HLS playlist URLs', () => {
    assert.equal(
      buildOfflinePlaybackHttpUrl('http://127.0.0.1:41234/', 'vid-1'),
      'http://127.0.0.1:41234/vid-1/offline-master.m3u8',
    );
    assert.equal(
      buildOfflinePlaybackHttpUrl('http://127.0.0.1:9', 'a/b'),
      'http://127.0.0.1:9/a%2Fb/offline-master.m3u8',
    );
  });
});
