/**
 * When preview_duration matches (or exceeds) full_duration, non-subscribers get the full
 * episode in the web player and RSS should use podcast.mp3 — not a duplicate preview MP3.
 */

export const PREVIEW_FULL_UNLOCK_EPSILON_SEC = 0.5

export function isFullPublicPreview(
  previewDurationSeconds: unknown,
  fullDurationSeconds: unknown,
): boolean {
  const preview = Number(previewDurationSeconds) || 0
  const full = Number(fullDurationSeconds) || 0
  if (preview <= 0 || full <= 0) return false
  return preview >= full - PREVIEW_FULL_UNLOCK_EPSILON_SEC
}

/** True when a trimmed podcast_preview.mp3 should exist on the media host. */
export function needsPodcastPreviewMp3(
  previewDurationSeconds: unknown,
  fullDurationSeconds: unknown,
): boolean {
  const preview = Number(previewDurationSeconds) || 0
  if (preview <= 0) return false
  return !isFullPublicPreview(preview, fullDurationSeconds)
}
