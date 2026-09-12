/**
 * Aggressive async HLS startup prefetch: master → lowest-bandwidth variant →
 * init + first N media segments (+ audio when demuxed).
 *
 * Used on the watch page (before Video.js boots) and for above-the-fold cards.
 * Relies on Worker path-keyed Cache API so a later play with a fresh `vt` still HIT.
 */

export type HlsStartupPrefetchOptions = {
  /** Number of media segments to warm (default 2). */
  segmentCount?: number;
  signal?: AbortSignal;
  /** fetch priority hint when supported. */
  priority?: RequestPriority;
};

export type PickedVariantPlaylist = {
  url: string;
  /** `#EXT-X-STREAM-INF` AUDIO= group id, when present. */
  audioGroup: string | null;
};

function resolveUrl(base: string, ref: string): string {
  try {
    const resolved = new URL(ref, base);
    // Relative / query-less refs must inherit signed `vt` (and previewUntil) from the parent.
    // Only copy when same-origin so cross-origin absolute URIs do not receive auth params.
    if (!ref.includes('?')) {
      const parent = new URL(base);
      if (resolved.origin === parent.origin) {
        for (const [key, value] of parent.searchParams.entries()) {
          if (!resolved.searchParams.has(key)) resolved.searchParams.set(key, value);
        }
      }
    }
    return resolved.toString();
  } catch {
    return ref;
  }
}

function parseAttributeList(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi;
  let match = re.exec(body);
  while (match) {
    const key = match[1]?.toUpperCase();
    if (key) attrs[key] = match[3] ?? match[2] ?? '';
    match = re.exec(body);
  }
  return attrs;
}

/** Pick the lowest BANDWIDTH media playlist (and its AUDIO group) from a master. */
export function pickLowestBandwidthVariant(
  masterText: string,
  masterUrl: string,
): PickedVariantPlaylist | null {
  const lines = masterText.split(/\r?\n/);
  let best: PickedVariantPlaylist | null = null;
  let bestBw = Number.POSITIVE_INFINITY;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line?.startsWith('#EXT-X-STREAM-INF')) continue;
    const attrs = parseAttributeList(line);
    const bw = Number.parseInt(attrs.BANDWIDTH ?? '', 10);
    const next = lines[i + 1]?.trim();
    if (!next || next.startsWith('#')) continue;
    const url = resolveUrl(masterUrl, next);
    const audioGroup = (attrs.AUDIO ?? '').trim() || null;
    if (Number.isFinite(bw) && bw < bestBw) {
      bestBw = bw;
      best = { url, audioGroup };
    } else if (!Number.isFinite(bw) && !best) {
      best = { url, audioGroup };
    }
  }
  return best;
}

/** Pick the lowest BANDWIDTH media playlist URL from a master manifest. */
export function pickLowestBandwidthPlaylistUrl(
  masterText: string,
  masterUrl: string,
): string | null {
  return pickLowestBandwidthVariant(masterText, masterUrl)?.url ?? null;
}

/**
 * Collect demuxed audio media playlist URL(s) from `#EXT-X-MEDIA:TYPE=AUDIO`.
 * When `audioGroup` is set, only that GROUP-ID is considered and at most one
 * rendition is returned (DEFAULT=YES preferred, else first match).
 */
export function pickAudioPlaylistUrls(
  masterText: string,
  masterUrl: string,
  audioGroup?: string | null,
): string[] {
  const matches: { url: string; isDefault: boolean }[] = [];
  const wanted = audioGroup?.trim() || null;
  for (const raw of masterText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = parseAttributeList(line);
    if ((attrs.TYPE ?? '').toUpperCase() !== 'AUDIO') continue;
    if (wanted && (attrs['GROUP-ID'] ?? '').trim() !== wanted) continue;
    const uri = attrs.URI?.trim();
    if (!uri) continue;
    matches.push({
      url: resolveUrl(masterUrl, uri),
      isDefault: (attrs.DEFAULT ?? '').toUpperCase() === 'YES',
    });
  }
  if (!wanted) return matches.map((m) => m.url);
  const preferred = matches.find((m) => m.isDefault) ?? matches[0];
  return preferred ? [preferred.url] : [];
}

/** Init URI + first N segment URLs from a media playlist. */
export function collectStartupMediaUrls(
  playlistText: string,
  playlistUrl: string,
  segmentCount: number,
): string[] {
  const out: string[] = [];
  const lines = playlistText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('#EXT-X-MAP:')) continue;
    const attrs = parseAttributeList(line);
    if (attrs.URI) out.push(resolveUrl(playlistUrl, attrs.URI));
  }
  let taken = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.push(resolveUrl(playlistUrl, line));
    taken += 1;
    if (taken >= segmentCount) break;
  }
  return out;
}

async function fetchText(url: string, signal?: AbortSignal, priority?: RequestPriority) {
  const init: RequestInit & { priority?: RequestPriority } = {
    method: 'GET',
    credentials: 'omit',
    signal,
  };
  if (priority) init.priority = priority;
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`prefetch ${res.status}`);
  return res.text();
}

async function warmUrls(urls: string[], signal?: AbortSignal, priority?: RequestPriority) {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const init: RequestInit & { priority?: RequestPriority } = {
          method: 'GET',
          credentials: 'omit',
          signal,
        };
        if (priority) init.priority = priority;
        const res = await fetch(url, init);
        // Drain so the Worker Cache API put (waitUntil) can complete on the edge.
        if (res.ok) await res.arrayBuffer().catch(() => undefined);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
      }
    }),
  );
}

/**
 * Prefetch the cheapest startup ladder rung (and audio) for a master playlist URL.
 * Safe to fire-and-forget; never throws except AbortError when `signal` aborts.
 */
export async function prefetchHlsStartup(
  masterPlaylistUrl: string,
  options: HlsStartupPrefetchOptions = {},
): Promise<void> {
  const segmentCount = Math.max(1, Math.min(options.segmentCount ?? 2, 4));
  const priority = options.priority ?? 'low';
  const { signal } = options;
  if (!masterPlaylistUrl?.trim()) return;

  try {
    const masterText = await fetchText(masterPlaylistUrl, signal, priority);
    const variant = pickLowestBandwidthVariant(masterText, masterPlaylistUrl);
    if (!variant) return;
    const audioUrls = pickAudioPlaylistUrls(masterText, masterPlaylistUrl, variant.audioGroup);
    const targets = [variant.url, ...audioUrls];

    await Promise.all(
      targets.map(async (playlistUrl) => {
        const text = await fetchText(playlistUrl, signal, priority);
        const media = collectStartupMediaUrls(text, playlistUrl, segmentCount);
        await warmUrls(media, signal, priority);
      }),
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Best-effort warmup — playback still goes through the normal path.
  }
}
