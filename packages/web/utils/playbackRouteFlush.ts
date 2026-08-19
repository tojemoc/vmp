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
