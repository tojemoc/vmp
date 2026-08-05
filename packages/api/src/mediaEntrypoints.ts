/**
 * packages/api/src/mediaEntrypoints.js
 *
 * Shared helpers to resolve which HLS entrypoint exists in R2 and to build
 * proxy URLs that point at /api/video-proxy.
 */

import { getRequestPublicOrigin } from './requestPublicOrigin.js';

export function buildEntrypointCandidates(base: any, videoId: any, options: any = {}) {
  const preferPodcast = options?.preferPodcast === true;
  /** When true, prefer assets that match the current preview window (HLS or podcast_preview.mp3). */
  const rssPreview = options?.rssPreview === true && preferPodcast;
  const candidates = [];
  if (preferPodcast) {
    if (rssPreview) {
      candidates.push(
        `${base}/videos/${videoId}/podcast_preview.mp3`,
        `${base}/videos/${videoId}/processed/podcast_preview.mp3`,
      );
    } else {
      candidates.push(
        `${base}/videos/${videoId}/podcast.mp3`,
        `${base}/videos/${videoId}/processed/podcast.mp3`,
        `${base}/videos/${videoId}/processed/audio/podcast.mp3`,
      );
    }
  }
  candidates.push(
    `${base}/videos/${videoId}/master.m3u8`,
    `${base}/videos/${videoId}/processed/hls/master.m3u8`,
    `${base}/videos/${videoId}/processed/playlist.m3u8`,
  );
  return candidates;
}

export async function resolveMediaEntrypointUrl({
  env,
  videoId,
  preferPodcast = false,
  rssPreview = false,
  bunnyPlaybackUrl = null,
}: {
  env: { R2_BASE_URL?: string };
  videoId: string;
  preferPodcast?: boolean;
  rssPreview?: boolean;
  /** Bunny Stream HLS manifest on Bunny CDN — used when R2 has no processed artifact. */
  bunnyPlaybackUrl?: string | null;
}) {
  const base = env.R2_BASE_URL;
  const candidates = buildEntrypointCandidates(base, videoId, { preferPodcast, rssPreview });
  for (const c of candidates) {
    if (await canLoadEntrypoint(c)) return c;
  }
  // TODO: Bunny CDN URLs bypass /api/video-proxy — preview manifest truncation does not apply.
  if (bunnyPlaybackUrl && typeof bunnyPlaybackUrl === 'string' && bunnyPlaybackUrl.trim()) {
    return bunnyPlaybackUrl.trim();
  }
  return candidates[0];
}

export function buildProxyPlaylistUrl(
  request: any,
  playlistUrl: any,
  previewUntilSeconds: any,
  env?: { API_PUBLIC_URL?: string },
) {
  const origin = getRequestPublicOrigin(request, env);
  const upstream = new URL(playlistUrl);
  const u = new URL(`${origin}/api/video-proxy${upstream.pathname}`);
  if (typeof previewUntilSeconds === 'number' && previewUntilSeconds >= 0) {
    u.searchParams.set('previewUntil', String(Math.floor(previewUntilSeconds)));
  }
  return u.toString();
}

async function canLoadEntrypoint(url: any) {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/** Cache-Control for /api/video-proxy responses based on object path + manifest type. */
export function getVideoProxyCacheControl(objectPath: any, manifestType: any) {
  if (manifestType === 'hls') {
    // Playlists are frequently rewritten (preview boundaries, tokenized URLs), so
    // keep them short-lived while still allowing CDN edge caching.
    return 'public, max-age=60, s-maxage=60';
  }

  // HLS media segments and init files are immutable once published in VOD flows.
  if (objectPath.endsWith('.m4s') || /(^|\/)init[^/]*\.mp4$/i.test(objectPath)) {
    return 'public, max-age=31536000, immutable';
  }

  return null;
}
