/** Minimum meaningful watch position before we persist (seconds). */
export const PLAYBACK_POSITION_MIN_SAVE_SECONDS = 5;

/** Max absolute seconds from end before clearing (long-form). */
export const PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS = 30;

/** Min fraction of duration treated as "near end" for short-form (15% → clear at 85%). */
export const PLAYBACK_POSITION_END_EPSILON_MIN_FRACTION = 0.15;

/** Fraction of duration at/above which we clear for long-form. */
export const PLAYBACK_POSITION_END_FRACTION_LONG = 0.95;

/** Videos at or below this duration use proportional near-end thresholds. */
export const PLAYBACK_POSITION_SHORT_FORM_MAX_SECONDS = 300;

export const PLAYBACK_POSITION_SAVE_INTERVAL_MAX_MS = 30_000;
export const PLAYBACK_POSITION_SAVE_INTERVAL_MIN_MS = 5_000;

/** Max client clock ahead-of-server before we clamp incoming timestamps (ms). */
export const PLAYBACK_POSITION_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PlaybackEndClearThresholds = {
  epsilonSeconds: number;
  endFraction: number;
};

/**
 * Duration-tiered near-end thresholds: short clips use a proportional tail (15%),
 * long-form keeps the 30s absolute cap plus 95% fraction (whichever triggers first).
 */
export function getPlaybackEndClearThresholds(
  durationSeconds: number | null | undefined,
): PlaybackEndClearThresholds {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      epsilonSeconds: PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS,
      endFraction: PLAYBACK_POSITION_END_FRACTION_LONG,
    };
  }

  if (durationSeconds <= PLAYBACK_POSITION_SHORT_FORM_MAX_SECONDS) {
    const proportionalEpsilon = Math.max(
      PLAYBACK_POSITION_MIN_SAVE_SECONDS,
      durationSeconds * PLAYBACK_POSITION_END_EPSILON_MIN_FRACTION,
    );
    const epsilonSeconds = Math.min(
      proportionalEpsilon,
      PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS,
    );
    const endFraction = 1 - epsilonSeconds / durationSeconds;
    return { epsilonSeconds, endFraction };
  }

  return {
    epsilonSeconds: PLAYBACK_POSITION_END_EPSILON_MAX_SECONDS,
    endFraction: PLAYBACK_POSITION_END_FRACTION_LONG,
  };
}

export function isNearPlaybackEnd(
  positionSeconds: number,
  durationSeconds: number | null | undefined,
): boolean {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return false;
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }
  const { epsilonSeconds, endFraction } = getPlaybackEndClearThresholds(durationSeconds);
  const remaining = durationSeconds - positionSeconds;
  return remaining <= epsilonSeconds || positionSeconds / durationSeconds >= endFraction;
}

/** Shorter clips save more frequently (target ~10% of duration, clamped 5–30s). */
export function getPlaybackSaveIntervalMs(durationSeconds: number | null | undefined): number {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return PLAYBACK_POSITION_SAVE_INTERVAL_MAX_MS;
  }
  const byDuration = durationSeconds * 0.1 * 1000;
  return Math.round(
    Math.max(
      PLAYBACK_POSITION_SAVE_INTERVAL_MIN_MS,
      Math.min(PLAYBACK_POSITION_SAVE_INTERVAL_MAX_MS, byDuration),
    ),
  );
}

export function normalizeClientCapturedAtMs(
  raw: number | null | undefined,
  serverNowMs: number,
): number {
  const value = raw != null && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : serverNowMs;
  if (value > serverNowMs + PLAYBACK_POSITION_MAX_CLOCK_SKEW_MS) {
    return serverNowMs;
  }
  return value;
}

export function shouldRejectStalePlaybackWrite(opts: {
  existingCapturedAtMs: number | null | undefined;
  incomingCapturedAtMs: number | null | undefined;
  serverNowMs?: number;
}): boolean {
  const existing = opts.existingCapturedAtMs;
  const incoming = opts.incomingCapturedAtMs;
  if (existing == null || incoming == null) return false;
  if (!Number.isFinite(existing) || !Number.isFinite(incoming)) return false;

  const serverNowMs = opts.serverNowMs ?? Date.now();
  if (existing > serverNowMs + PLAYBACK_POSITION_MAX_CLOCK_SKEW_MS) {
    return false;
  }

  return incoming < existing;
}
