/**
 * Claim the video ID whose player state should be flushed on route change.
 * Clears the active ID so rapid A → B → C navigation cannot flush stale route params.
 */
export function claimActivePlayerVideoIdForFlush(activePlayerVideoId: {
  value: string | null;
}): string | null {
  const claimed = activePlayerVideoId.value;
  activePlayerVideoId.value = null;
  if (claimed == null) return null;
  const trimmed = String(claimed).trim();
  return trimmed ? trimmed : null;
}

/**
 * Assign the active player video ID only after the player for this invocation is ready.
 * Stale A/B navigations must not claim the C route (or any later route).
 */
export function assignActivePlayerVideoIdIfCurrent(
  activePlayerVideoId: { value: string | null },
  videoId: string | null | undefined,
  isCurrentInvocation: () => boolean,
): void {
  if (!isCurrentInvocation()) return;
  if (videoId == null) return;
  const trimmed = String(videoId).trim();
  if (!trimmed) return;
  activePlayerVideoId.value = trimmed;
}
