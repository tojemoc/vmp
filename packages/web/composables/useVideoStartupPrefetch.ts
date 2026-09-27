import { computed, onBeforeUnmount, provide, type Ref } from 'vue';
import { prefetchHlsStartup } from '~/utils/hlsStartupPrefetch';

/**
 * Reserved for callers that opt into a local anon warmup budget.
 * Anonymous clients do not receive signed playlists without `X-VMP-Watch-View`,
 * so catalog HLS prefetch is logged-in only (avoids quota bypass via warmup).
 */
export const ANON_STARTUP_PREFETCH_BUDGET = 0;

/** Default media segments to warm per video (init + first N). */
export const DEFAULT_STARTUP_SEGMENT_COUNT = 3;

/**
 * Shared catalog HLS warmup queue.
 *
 * Strategy (opposite of “disable HLS preload”): aggressively warm the cheapest
 * ladder rung for above-the-fold cards + a bit beyond, async/low-priority.
 * Logged-in users are uncapped. Anonymous viewers skip catalog warmup because
 * playable `video-access` requires an intentional /watch open (quota + cookie).
 */
export function useVideoStartupPrefetch(options: {
  apiUrl: string;
  authHeaders: () => Record<string, string>;
  isLoggedIn: Ref<boolean>;
  segmentCount?: number;
  anonBudget?: number;
}) {
  const warmed = new Set<string>();
  const inFlight = new Map<string, AbortController>();
  const anonBudget = options.anonBudget ?? ANON_STARTUP_PREFETCH_BUDGET;
  let anonAttempts = 0;
  let active = 0;
  const queue: string[] = [];

  // Always observe visibility — hover alone is too late for “above the fold”.
  const mode = computed<'visible' | 'hover'>(() => 'visible');

  const maxConcurrent = () => (options.isLoggedIn.value ? 4 : 2);

  const anonBudgetRemaining = () => {
    if (options.isLoggedIn.value) return Number.POSITIVE_INFINITY;
    return Math.max(0, anonBudget - anonAttempts);
  };

  const runNext = () => {
    while (active < maxConcurrent() && queue.length) {
      if (!options.isLoggedIn.value && anonBudgetRemaining() <= 0) {
        queue.length = 0;
        break;
      }
      const key = queue.shift();
      if (!key || warmed.has(key)) continue;
      active += 1;
      void warmVideo(key).finally(() => {
        active -= 1;
        runNext();
      });
    }
  };

  const enqueue = (videoKey: string) => {
    if (!videoKey || warmed.has(videoKey) || inFlight.has(videoKey) || queue.includes(videoKey)) {
      return;
    }
    // Anonymous: no playable playlist without watch header — skip catalog warmup.
    if (!options.isLoggedIn.value) return;
    queue.push(videoKey);
    runNext();
  };

  /** Eagerly enqueue an ordered list (homepage/category above-the-fold). */
  const enqueueMany = (videoKeys: string[]) => {
    for (const key of videoKeys) enqueue(key);
  };

  const warmVideo = async (videoKey: string) => {
    if (warmed.has(videoKey)) return;
    if (!options.isLoggedIn.value) return;
    const controller = new AbortController();
    inFlight.set(videoKey, controller);
    try {
      const res = await fetch(
        `${options.apiUrl}/api/video-access/${encodeURIComponent(videoKey)}`,
        {
          headers: { ...options.authHeaders() },
          credentials: 'include',
          signal: controller.signal,
          priority: 'low',
        } as RequestInit,
      );
      if (res.status === 429) {
        queue.length = 0;
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { video?: { playlistUrl?: string } };
      const playlistUrl = data.video?.playlistUrl;
      if (!playlistUrl) return;
      await prefetchHlsStartup(playlistUrl, {
        segmentCount: options.segmentCount ?? DEFAULT_STARTUP_SEGMENT_COUNT,
        signal: controller.signal,
        priority: 'low',
      });
      warmed.add(videoKey);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      inFlight.delete(videoKey);
    }
  };

  provide('enqueueVideoStartupPrefetch', enqueue);
  provide('videoStartupPrefetchMode', mode);

  onBeforeUnmount(() => {
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
    queue.length = 0;
  });

  return {
    enqueue,
    enqueueMany,
    mode,
    /** Test/inspection helper */
    getAnonAttempts: () => anonAttempts,
    getAnonBudget: () => anonBudget,
  };
}
