export type WatchListVideo = {
  id: string
  slug?: string | null
  category_id?: string | null
}

export type BuildWatchRecommendationsOptions = {
  /** Canonical video id from video-access (resolved from slug when needed). */
  currentVideoId: string
  /** Route param: video id or vanity slug. */
  routeVideoKey?: string
  limit?: number
}

function isCurrentVideo(video: WatchListVideo, options: BuildWatchRecommendationsOptions): boolean {
  const { currentVideoId, routeVideoKey } = options
  if (video.id === currentVideoId) return true
  if (!routeVideoKey) return false
  return video.id === routeVideoKey || video.slug === routeVideoKey
}

/**
 * Builds the watch-page "Up Next" list: excludes the playing video, prefers same category,
 * preserves API publish-date order within each group.
 */
export function buildWatchRecommendations(
  videos: WatchListVideo[],
  options: BuildWatchRecommendationsOptions
): WatchListVideo[] {
  const rawLimit = Number(options.limit ?? 5)
  const limit = Number.isFinite(rawLimit) ? Math.max(0, Math.floor(rawLimit)) : 5
  const candidates = videos.filter((v) => !isCurrentVideo(v, options))
  if (candidates.length === 0) return []

  const current =
    videos.find((v) => v.id === options.currentVideoId) ??
    (options.routeVideoKey
      ? videos.find(
          (v) => v.id === options.routeVideoKey || v.slug === options.routeVideoKey
        )
      : undefined)
  const trimmedCategory =
    typeof current?.category_id === 'string' ? current.category_id.trim() : ''
  const categoryId = trimmedCategory || null

  if (!categoryId) return candidates.slice(0, limit)

  const sameCategory: WatchListVideo[] = []
  const other: WatchListVideo[] = []
  for (const video of candidates) {
    const videoCategory =
      typeof video.category_id === 'string' ? video.category_id.trim() : ''
    if (videoCategory === categoryId) sameCategory.push(video)
    else other.push(video)
  }
  return [...sameCategory, ...other].slice(0, limit)
}
