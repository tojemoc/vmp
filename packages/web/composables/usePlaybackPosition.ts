/**
 * Persist / resume last VOD playback position for signed-in users (#488).
 *
 * Anti-spam:
 * - Skip saves while the user is scrubbing (seeking).
 * - Periodic saves only while playback is actively progressing.
 * - Always flush on navigate-away / before switching videos (force=true).
 */

export const PLAYBACK_POSITION_SAVE_INTERVAL_MS = 30_000;
export const PLAYBACK_POSITION_MIN_RESUME_SECONDS = 5;
export const PLAYBACK_POSITION_END_EPSILON_SECONDS = 30;
export const PLAYBACK_POSITION_END_FRACTION = 0.95;

export type PlaybackPositionSaveReason = 'periodic' | 'flush';

export function shouldResumePlaybackPosition(
  positionSeconds: number | null | undefined,
  durationSeconds: number | null | undefined,
): boolean {
  if (positionSeconds == null || !Number.isFinite(positionSeconds)) return false;
  if (positionSeconds < PLAYBACK_POSITION_MIN_RESUME_SECONDS) return false;
  if (durationSeconds != null && durationSeconds > 0) {
    const remaining = durationSeconds - positionSeconds;
    if (
      remaining <= PLAYBACK_POSITION_END_EPSILON_SECONDS ||
      positionSeconds / durationSeconds >= PLAYBACK_POSITION_END_FRACTION
    ) {
      return false;
    }
  }
  return true;
}

export function shouldSavePlaybackPosition(opts: {
  positionSeconds: number;
  durationSeconds: number | null | undefined;
  isSeeking: boolean;
  reason: PlaybackPositionSaveReason;
  activelyWatching: boolean;
}): boolean {
  if (!Number.isFinite(opts.positionSeconds) || opts.positionSeconds < 0) return false;
  if (opts.isSeeking && opts.reason !== 'flush') return false;
  if (opts.reason === 'periodic' && !opts.activelyWatching) return false;
  if (opts.positionSeconds < PLAYBACK_POSITION_MIN_RESUME_SECONDS) {
    // Still allow flush so we can clear near-start / finished state server-side.
    return opts.reason === 'flush';
  }
  if (opts.durationSeconds != null && opts.durationSeconds > 0) {
    const remaining = opts.durationSeconds - opts.positionSeconds;
    if (
      remaining <= PLAYBACK_POSITION_END_EPSILON_SECONDS ||
      opts.positionSeconds / opts.durationSeconds >= PLAYBACK_POSITION_END_FRACTION
    ) {
      return opts.reason === 'flush';
    }
  }
  return true;
}

export function usePlaybackPosition(options: {
  apiUrl: () => string;
  authHeader: () => Record<string, string>;
  enabled: () => boolean;
  videoId: () => string;
  getPosition: () => number;
  getDuration: () => number;
  isSeeking: () => boolean;
  isActivelyWatching: () => boolean;
}) {
  let lastSavedPosition: number | null = null;
  let lastSaveAtMs = 0;
  let inFlight: Promise<void> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function fetchSavedPosition(videoId: string): Promise<number | null> {
    if (!options.enabled() || !videoId) return null;
    const headers = options.authHeader();
    if (!headers.Authorization) return null;
    try {
      const res = await fetch(
        `${options.apiUrl()}/api/account/playback-positions/${encodeURIComponent(videoId)}`,
        { headers },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { positionSeconds?: number | null };
      const position =
        typeof data.positionSeconds === 'number' && Number.isFinite(data.positionSeconds)
          ? data.positionSeconds
          : null;
      return position;
    } catch {
      return null;
    }
  }

  async function savePosition(reason: PlaybackPositionSaveReason): Promise<void> {
    if (!options.enabled()) return;
    const videoId = options.videoId();
    if (!videoId) return;

    const positionSeconds = options.getPosition();
    const durationSeconds = options.getDuration();
    const headers = options.authHeader();
    if (!headers.Authorization) return;

    if (
      !shouldSavePlaybackPosition({
        positionSeconds,
        durationSeconds,
        isSeeking: options.isSeeking(),
        reason,
        activelyWatching: options.isActivelyWatching(),
      })
    ) {
      return;
    }

    // Skip redundant periodic saves when the playhead has barely moved.
    if (
      reason === 'periodic' &&
      lastSavedPosition != null &&
      Math.abs(positionSeconds - lastSavedPosition) < 2
    ) {
      return;
    }

    const force = reason === 'flush';
    const body = JSON.stringify({
      positionSeconds,
      durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
      force,
    });

    const run = async () => {
      try {
        await fetch(
          `${options.apiUrl()}/api/account/playback-positions/${encodeURIComponent(videoId)}`,
          {
            method: 'PUT',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body,
            keepalive: force,
          },
        );
        lastSavedPosition = positionSeconds;
        lastSaveAtMs = Date.now();
      } catch {
        // Best-effort; resume still works from the last successful write.
      }
    };

    if (inFlight && !force) {
      return;
    }
    inFlight = run().finally(() => {
      inFlight = null;
    });
    await inFlight;
  }

  function startPeriodicSaves() {
    stopPeriodicSaves();
    if (!import.meta.client) return;
    intervalId = setInterval(() => {
      void savePosition('periodic');
    }, PLAYBACK_POSITION_SAVE_INTERVAL_MS);
  }

  function stopPeriodicSaves() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function flush() {
    void savePosition('flush');
  }

  function resetLocalState() {
    lastSavedPosition = null;
    lastSaveAtMs = 0;
  }

  if (import.meta.client) {
    const onPageHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    onMounted(() => {
      window.addEventListener('pagehide', onPageHide);
      document.addEventListener('visibilitychange', onVisibility);
      startPeriodicSaves();
    });

    onUnmounted(() => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      stopPeriodicSaves();
      flush();
    });
  }

  return {
    fetchSavedPosition,
    savePosition,
    flush,
    startPeriodicSaves,
    stopPeriodicSaves,
    resetLocalState,
    /** Exposed for tests / debugging. */
    getLastSaveMeta: () => ({ lastSavedPosition, lastSaveAtMs }),
  };
}
