/**
 * Persist / resume last VOD playback position for signed-in users (#488).
 *
 * Anti-spam:
 * - Skip saves while the user is scrubbing (seeking).
 * - Periodic saves only while playback is actively progressing.
 * - Always flush on navigate-away / before switching videos (force=true).
 * - Writes are serialized so lifecycle flushes cannot be overwritten by stale periodic saves.
 */

import {
  getPlaybackSaveIntervalMs,
  isNearPlaybackEnd,
  normalizeClientCapturedAtMs,
  PLAYBACK_POSITION_MIN_SAVE_SECONDS,
} from '@vmp/shared';

export {
  getPlaybackEndClearThresholds,
  getPlaybackSaveIntervalMs,
  isNearPlaybackEnd,
  PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS,
  PLAYBACK_POSITION_END_FRACTION_LONG,
  PLAYBACK_POSITION_MIN_SAVE_SECONDS,
  PLAYBACK_POSITION_SAVE_INTERVAL_MAX_MS,
  PLAYBACK_POSITION_SAVE_INTERVAL_MIN_MS,
} from '@vmp/shared';

/** @deprecated Use PLAYBACK_POSITION_SAVE_INTERVAL_MAX_MS from @vmp/shared */
export const PLAYBACK_POSITION_SAVE_INTERVAL_MS = 30_000;

/** @deprecated Use PLAYBACK_POSITION_MIN_SAVE_SECONDS from @vmp/shared */
export const PLAYBACK_POSITION_MIN_RESUME_SECONDS = PLAYBACK_POSITION_MIN_SAVE_SECONDS;

/** @deprecated Use PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS from @vmp/shared */
export const PLAYBACK_POSITION_END_EPSILON_SECONDS = 30;

/** @deprecated Use PLAYBACK_POSITION_END_FRACTION_LONG from @vmp/shared */
export const PLAYBACK_POSITION_END_FRACTION = 0.95;

export type PlaybackPositionSaveReason = 'periodic' | 'flush';

export function shouldResumePlaybackPosition(
  positionSeconds: number | null | undefined,
  durationSeconds: number | null | undefined,
): boolean {
  if (positionSeconds == null || !Number.isFinite(positionSeconds)) return false;
  if (positionSeconds < PLAYBACK_POSITION_MIN_SAVE_SECONDS) return false;
  if (isNearPlaybackEnd(positionSeconds, durationSeconds)) return false;
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
  if (opts.positionSeconds < PLAYBACK_POSITION_MIN_SAVE_SECONDS) {
    return opts.reason === 'flush';
  }
  if (isNearPlaybackEnd(opts.positionSeconds, opts.durationSeconds)) {
    return opts.reason === 'flush';
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
  let writeChain: Promise<void> = Promise.resolve();
  let periodicTimeoutId: ReturnType<typeof setTimeout> | null = null;

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

  async function deleteSavedPosition(videoId: string): Promise<boolean> {
    const headers = options.authHeader();
    if (!headers.Authorization) return false;
    try {
      const res = await fetch(
        `${options.apiUrl()}/api/account/playback-positions/${encodeURIComponent(videoId)}`,
        { method: 'DELETE', headers },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async function savePosition(
    reason: PlaybackPositionSaveReason,
    overrideVideoId?: string,
  ): Promise<void> {
    const serverNowMs = Date.now();
    const capturedAtMs = normalizeClientCapturedAtMs(serverNowMs, serverNowMs);
    const task = async () => {
      const videoId = overrideVideoId ?? options.videoId();
      if (!videoId) return;
      if (!overrideVideoId && !options.enabled()) return;

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
        capturedAtMs,
      });

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

    writeChain = writeChain.then(task, task);
    return writeChain;
  }

  function scheduleNextPeriodicSave() {
    stopPeriodicSaves();
    if (!import.meta.client) return;
    const intervalMs = getPlaybackSaveIntervalMs(options.getDuration());
    periodicTimeoutId = setTimeout(() => {
      void savePosition('periodic').finally(() => scheduleNextPeriodicSave());
    }, intervalMs);
  }

  function startPeriodicSaves() {
    scheduleNextPeriodicSave();
  }

  function stopPeriodicSaves() {
    if (periodicTimeoutId != null) {
      clearTimeout(periodicTimeoutId);
      periodicTimeoutId = null;
    }
  }

  async function flush(overrideVideoId?: string): Promise<void> {
    return savePosition('flush', overrideVideoId);
  }

  function resetLocalState() {
    lastSavedPosition = null;
    lastSaveAtMs = 0;
  }

  if (import.meta.client) {
    const onPageHide = () => {
      void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
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
      void flush();
    });
  }

  return {
    fetchSavedPosition,
    deleteSavedPosition,
    savePosition,
    flush,
    startPeriodicSaves,
    stopPeriodicSaves,
    resetLocalState,
    getLastSaveMeta: () => ({ lastSavedPosition, lastSaveAtMs }),
  };
}
