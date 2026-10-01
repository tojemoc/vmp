import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPublicAssetUrl,
  extractPublicAssetKey,
  getPublicAssetsBaseUrl,
  isAllowlistedPublicAssetKey,
  rewriteStoredPublicObjectUrl,
} from '../src/publicAssets.js';

describe('publicAssets URL helpers', () => {
  const env = { API_URL: 'https://vmp-api.tjm.sk' };

  it('allowlists only public prefixes', () => {
    assert.equal(isAllowlistedPublicAssetKey('thumbnails/vid/large.jpg'), true);
    assert.equal(isAllowlistedPublicAssetKey('cms/foo.png'), true);
    assert.equal(isAllowlistedPublicAssetKey('pills/x.webp'), true);
    assert.equal(isAllowlistedPublicAssetKey('videos/vid/master.m3u8'), false);
  });

  it('builds Worker asset URLs from API_URL', () => {
    assert.equal(
      buildPublicAssetUrl(env, 'thumbnails/vid/large.jpg', { v: '1' }),
      'https://vmp-api.tjm.sk/api/assets/thumbnails/vid/large.jpg?v=1',
    );
    assert.equal(getPublicAssetsBaseUrl(env), 'https://vmp-api.tjm.sk/api/assets');
  });

  it('extracts keys from legacy CDN and /api/assets URLs', () => {
    assert.equal(
      extractPublicAssetKey('https://vmp-videos.tjm.sk/thumbnails/vid/large.jpg?v=9'),
      'thumbnails/vid/large.jpg',
    );
    assert.equal(extractPublicAssetKey('https://vmp-api.tjm.sk/api/assets/cms/x.png'), 'cms/x.png');
    assert.equal(extractPublicAssetKey('https://cdn.example/videos/x/master.m3u8'), null);
  });

  it('rewrites legacy thumbnail URLs to the asset proxy', () => {
    assert.equal(
      rewriteStoredPublicObjectUrl('https://vmp-videos.tjm.sk/thumbnails/vid/large.jpg?v=42', env),
      'https://vmp-api.tjm.sk/api/assets/thumbnails/vid/large.jpg?v=42',
    );
  });
});
