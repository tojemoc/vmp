import type { OfflineRendition } from '@vmp/shared';

const RENDITION_RESOLUTION: Record<OfflineRendition, string> = {
  '480p': '854x480',
  '720p': '1280x720',
  '1080p': '1920x1080',
};

const RENDITION_BANDWIDTH: Record<OfflineRendition, number> = {
  '480p': 1_500_000,
  '720p': 3_000_000,
  '1080p': 5_000_000,
};

/** Normalize a relative/absolute-path URI against a playlist file path inside the video root. */
export function resolveAssetPath(playlistBasePath: string, uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file:')
  ) {
    return null;
  }

  const baseDir = playlistBasePath.includes('/')
    ? playlistBasePath.slice(0, playlistBasePath.lastIndexOf('/'))
    : '';

  const joined = trimmed.startsWith('/')
    ? trimmed.replace(/^\/+/, '')
    : baseDir
      ? `${baseDir}/${trimmed}`
      : trimmed;

  const normalized = joined
    .split('/')
    .filter((part) => part && part !== '.')
    .reduce<string[]>((acc, part) => {
      if (part === '..') {
        acc.pop();
        return acc;
      }
      acc.push(part);
      return acc;
    }, [])
    .join('/');

  return normalized || null;
}

/** Relative path from one file in the video tree to another (POSIX-style). */
export function relativePathBetween(fromFilePath: string, toAssetPath: string): string {
  const fromDirParts = fromFilePath.includes('/')
    ? fromFilePath.slice(0, fromFilePath.lastIndexOf('/')).split('/').filter(Boolean)
    : [];
  const toParts = toAssetPath.split('/').filter(Boolean);

  let common = 0;
  while (
    common < fromDirParts.length &&
    common < toParts.length &&
    fromDirParts[common] === toParts[common]
  ) {
    common += 1;
  }

  const ups = fromDirParts.length - common;
  const downs = toParts.slice(common);
  const rel = [...Array(ups).fill('..'), ...downs].join('/');
  return rel || '.';
}

/**
 * Rewrite an HLS playlist so media URIs are relative to `outputPlaylistPath`
 * inside the same offline video directory (native file:// playback).
 */
export function rewritePlaylistForOfflineRelative(
  playlistText: string,
  sourcePlaylistPath: string,
  outputPlaylistPath: string,
): string {
  const lines = playlistText.split('\n');
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        const mapMatch = trimmed.match(/URI="([^"]+)"/i);
        if (mapMatch?.[1]) {
          const resolved = resolveAssetPath(sourcePlaylistPath, mapMatch[1]);
          if (!resolved) return line;
          return trimmed.replace(mapMatch[1], relativePathBetween(outputPlaylistPath, resolved));
        }
        return line;
      }
      const resolved = resolveAssetPath(sourcePlaylistPath, trimmed);
      if (!resolved) return line;
      return relativePathBetween(outputPlaylistPath, resolved);
    })
    .join('\n');
}

export function buildOfflineMasterPlaylist(rendition: OfflineRendition, hasAudio: boolean): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];
  if (hasAudio) {
    lines.push(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,URI="offline-audio.m3u8"',
    );
  }
  const audioAttr = hasAudio ? ',AUDIO="audio"' : '';
  lines.push(
    `#EXT-X-STREAM-INF:BANDWIDTH=${RENDITION_BANDWIDTH[rendition]},RESOLUTION=${RENDITION_RESOLUTION[rendition]}${audioAttr}`,
    `${rendition}/offline-playlist.m3u8`,
  );
  return `${lines.join('\n')}\n`;
}
