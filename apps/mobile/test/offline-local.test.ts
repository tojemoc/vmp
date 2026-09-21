import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLicensePlaybackAllowed, isLicenseRevalidationDue } from '../src/offline/licenseClient';
import {
  buildOfflineMasterPlaylist,
  relativePathBetween,
  resolveAssetPath,
  rewritePlaylistForOfflineRelative,
} from '../src/offline/localManifest';
import type { OfflineLicense } from '@vmp/shared';

function sampleLicense(overrides: Partial<OfflineLicense> = {}): OfflineLicense {
  return {
    licenseId: 'lic-1',
    deviceId: 'dev-1',
    videoId: 'vid-1',
    rendition: '720p',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    manifestHash: 'abc',
    manifestVersion: 1,
    playbackState: 'allowed',
    nextValidationDueAt: new Date(Date.now() + 3_600_000).toISOString(),
    signature: 'sig',
    ...overrides,
  };
}

describe('mobile offline localManifest', () => {
  it('resolveAssetPath normalizes relative and absolute paths', () => {
    assert.equal(resolveAssetPath('720p/playlist.m3u8', 'seg0.ts'), '720p/seg0.ts');
    assert.equal(resolveAssetPath('720p/playlist.m3u8', '../audio/a.ts'), 'audio/a.ts');
    assert.equal(resolveAssetPath('720p/playlist.m3u8', '/720p/seg1.ts'), '720p/seg1.ts');
    assert.equal(resolveAssetPath('720p/playlist.m3u8', 'https://cdn.example/x.ts'), null);
  });

  it('relativePathBetween climbs correctly', () => {
    assert.equal(relativePathBetween('720p/offline-playlist.m3u8', '720p/seg0.ts'), 'seg0.ts');
    assert.equal(relativePathBetween('offline-master.m3u8', '720p/offline-playlist.m3u8'), '720p/offline-playlist.m3u8');
    assert.equal(relativePathBetween('720p/offline-playlist.m3u8', 'audio/a.ts'), '../audio/a.ts');
  });

  it('rewritePlaylistForOfflineRelative rewrites media lines and URI attrs', () => {
    const source = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      'seg0.ts',
      '../audio/a.ts',
      '',
    ].join('\n');
    const out = rewritePlaylistForOfflineRelative(source, '720p/playlist.m3u8', '720p/offline-playlist.m3u8');
    assert.match(out, /URI="init\.mp4"/);
    assert.match(out, /^seg0\.ts$/m);
    assert.match(out, /^\.\.\/audio\/a\.ts$/m);
  });

  it('buildOfflineMasterPlaylist points at relative offline playlists', () => {
    const withAudio = buildOfflineMasterPlaylist('720p', true);
    assert.match(withAudio, /URI="offline-audio\.m3u8"/);
    assert.match(withAudio, /720p\/offline-playlist\.m3u8/);
    const videoOnly = buildOfflineMasterPlaylist('480p', false);
    assert.doesNotMatch(videoOnly, /AUDIO=/);
    assert.match(videoOnly, /480p\/offline-playlist\.m3u8/);
  });
});

describe('mobile offline licenseClient', () => {
  it('isLicensePlaybackAllowed respects state and expiry', () => {
    assert.equal(isLicensePlaybackAllowed(sampleLicense()), true);
    assert.equal(isLicensePlaybackAllowed(sampleLicense({ playbackState: 'revoked' })), false);
    assert.equal(
      isLicensePlaybackAllowed(sampleLicense({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
      false,
    );
    assert.equal(isLicensePlaybackAllowed(null), false);
  });

  it('isLicenseRevalidationDue uses nextValidationDueAt', () => {
    assert.equal(isLicenseRevalidationDue(sampleLicense()), false);
    assert.equal(
      isLicenseRevalidationDue(
        sampleLicense({ nextValidationDueAt: new Date(Date.now() - 1000).toISOString() }),
      ),
      true,
    );
  });
});
