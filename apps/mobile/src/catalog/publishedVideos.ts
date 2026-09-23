/** Match public catalog rules used by `GET /api/videos` for non-editor viewers. */

export type CatalogVideoLike = {
  id: string;
  publish_status?: string | null;
  scheduled_publish_at?: string | null;
};

/**
 * Consumer surfaces (home catalog, Up next) must not show drafts/archived —
 * even when the signed-in user is editor+ and `/api/videos` returns all statuses.
 */
export function isPubliclyListedVideo(
  video: CatalogVideoLike,
  nowMs: number = Date.now(),
): boolean {
  if (video.publish_status !== 'published') return false;
  const scheduled = video.scheduled_publish_at;
  if (scheduled) {
    const at = Date.parse(String(scheduled));
    if (Number.isFinite(at) && at > nowMs) return false;
  }
  return true;
}

export function filterPubliclyListedVideos<T extends CatalogVideoLike>(
  videos: T[],
  nowMs: number = Date.now(),
): T[] {
  return videos.filter((v) => isPubliclyListedVideo(v, nowMs));
}
