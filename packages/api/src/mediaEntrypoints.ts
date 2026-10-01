/**
 * Shared helpers to resolve which HLS/podcast entrypoint exists in object storage
 * and to build proxy URLs that point at /api/video-proxy.
 */

import type { ObjectStorageProvider } from '@vmp/storage/worker';
import { getRequestPublicOrigin } from './requestPublicOrigin.js';

export function buildEntrypointCandidateKeys(videoId: string, options: any = {}) {
  const preferPodcast = options?.preferPodcast === true;
  /** When true, prefer assets that match the current preview window (HLS or podcast_preview.mp3). */
  const rssPreview = options?.rssPreview === true && preferPodcast;
  const candidates: string[] = [];
  if (preferPodcast) {
    if (rssPreview) {
      candidates.push(
        `videos/${videoId}/podcast_preview.mp3`,
        `videos/${videoId}/processed/podcast_preview.mp3`,
      );
    } else {
      candidates.push(
        `videos/${videoId}/podcast.mp3`,
        `videos/${videoId}/processed/podcast.mp3`,
        `videos/${videoId}/processed/audio/podcast.mp3`,
      );
    }
  }
  candidates.push(
    `videos/${videoId}/master.m3u8`,
    `videos/${videoId}/processed/hls/master.m3u8`,
    `videos/${videoId}/processed/playlist.m3u8`,
  );
  return candidates;
}

/**
 * @deprecated Prefer buildEntrypointCandidateKeys. Kept for tests that assert URL shapes.
 * Joins a legacy public base with relative entrypoint keys.
 */
export function buildEntrypointCandidates(base: any, videoId: any, options: any = {}) {
  const normalizedBase = String(base ?? '').replace(/\/$/, '');
  return buildEntrypointCandidateKeys(String(videoId), options).map(
    (key) => `${normalizedBase}/${key}`,
  );
}

export type MediaEntrypointResolution = {
  /** Object key (`videos/{id}/master.m3u8`) or absolute Bunny CDN URL. */
  url: string;
  /** True when storage HEAD succeeded or a configured Bunny playback URL was selected. */
  mediaFound: boolean;
};

type ResolveMediaEntrypointArgs = {
  env?: { R2_BASE_URL?: string };
  videoId: string;
  preferPodcast?: boolean;
  rssPreview?: boolean;
  /** Bunny Stream HLS manifest on Bunny CDN — used when storage has no processed artifact. */
  bunnyPlaybackUrl?: string | null;
  storage?: ObjectStorageProvider | null | undefined;
};

/**
 * Resolve the best HLS/podcast entrypoint and whether media was actually found.
 * Callers that only need the URL should use {@link resolveMediaEntrypointUrl}.
 */
export async function resolveMediaEntrypoint({
  videoId,
  preferPodcast = false,
  rssPreview = false,
  bunnyPlaybackUrl = null,
  storage,
}: ResolveMediaEntrypointArgs): Promise<MediaEntrypointResolution> {
  const provider = storage ?? null;
  if (provider) {
    const candidates = buildEntrypointCandidateKeys(videoId, { preferPodcast, rssPreview });
    for (const key of candidates) {
      try {
        const head = await provider.headObject(key);
        if (head) return { url: key, mediaFound: true };
      } catch {
        /* try next */
      }
    }
  }

  // TODO: Bunny CDN URLs bypass /api/video-proxy — preview manifest truncation does not apply.
  if (bunnyPlaybackUrl && typeof bunnyPlaybackUrl === 'string' && bunnyPlaybackUrl.trim()) {
    return { url: bunnyPlaybackUrl.trim(), mediaFound: true };
  }

  // Fall back to the preferred key so callers can still mint proxy URLs; playback 404s if missing.
  const fallback =
    buildEntrypointCandidateKeys(videoId, { preferPodcast, rssPreview })[0] ??
    `videos/${videoId}/master.m3u8`;
  return { url: fallback, mediaFound: false };
}

/** URL-only wrapper — preserves existing feed / offline / access callers. */
export async function resolveMediaEntrypointUrl(
  args: ResolveMediaEntrypointArgs,
): Promise<string> {
  const { url } = await resolveMediaEntrypoint(args);
  return url;
}

export function buildProxyPlaylistUrl(
  request: any,
  playlistUrlOrKey: any,
  previewUntilSeconds: any,
  env?: { API_PUBLIC_URL?: string },
) {
  const origin = getRequestPublicOrigin(request, env);
  const raw = String(playlistUrlOrKey ?? '');
  let pathname: string;
  if (/^https?:\/\//i.test(raw)) {
    pathname = new URL(raw).pathname;
  } else {
    pathname = `/${raw.replace(/^\/+/, '')}`;
  }
  const u = new URL(`${origin}/api/video-proxy${pathname}`);
  if (typeof previewUntilSeconds === 'number' && previewUntilSeconds >= 0) {
    u.searchParams.set('previewUntil', String(Math.floor(previewUntilSeconds)));
  }
  return u.toString();
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

/**
 * Reorder `#EXT-X-STREAM-INF` variant pairs by ascending BANDWIDTH so players that
 * start on the first listed rung (Video.js VHS / native HLS heuristics) begin on
 * the cheapest ladder step instead of 1080p.
 */
export function sortMasterPlaylistByBandwidth(manifest: string): string {
  const lines = manifest.split('\n');
  const head: string[] = [];
  const variants: { inf: string; uri: string; bandwidth: number }[] = [];
  const tail: string[] = [];
  let phase: 'head' | 'variants' | 'tail' = 'head';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
      phase = 'variants';
      const bwMatch = /(?:^|[,:\s])BANDWIDTH=(\d+)/i.exec(trimmed);
      const bandwidth = bwMatch ? Number.parseInt(bwMatch[1]!, 10) : Number.MAX_SAFE_INTEGER;
      const uri = lines[i + 1] ?? '';
      variants.push({
        inf: line,
        uri,
        bandwidth: Number.isFinite(bandwidth) ? bandwidth : Number.MAX_SAFE_INTEGER,
      });
      i += 1;
      continue;
    }
    if (phase === 'head') {
      head.push(line);
    } else if (phase === 'variants') {
      phase = 'tail';
      tail.push(line);
    } else {
      tail.push(line);
    }
  }

  if (variants.length <= 1) return manifest;

  variants.sort((a, b) => a.bandwidth - b.bandwidth);
  const sorted = variants.flatMap((v) => [v.inf, v.uri]);
  return [...head, ...sorted, ...tail].join('\n');
}
