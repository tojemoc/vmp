/** User-facing copy when the device has no usable network. */
export const OFFLINE_MODE_MESSAGE =
  'There is no internet connection. Only videos you downloaded beforehand work — open Downloads to play them.';

export const OFFLINE_PLAYBACK_FAILED_MESSAGE =
  'Offline playback failed. Try Remove and download again while online.';

export function isLikelyNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof (err as { message?: unknown }).message === 'string'
          ? String((err as { message: string }).message)
          : '';
  if (!message) return false;
  return /network request failed|failed to fetch|networkerror|internet|offline|timed?\s*out|econnrefused|enotfound|unreachable|socket|ssl|tls/i.test(
    message,
  );
}

/**
 * Map failures to safe UI copy. Never surfaces Error.message (may leak internals);
 * callers should log `err` separately when diagnostics are needed.
 */
export function userFacingRequestError(err: unknown, fallback = 'Request failed'): string {
  if (isLikelyNetworkError(err)) return OFFLINE_MODE_MESSAGE;
  return fallback;
}
