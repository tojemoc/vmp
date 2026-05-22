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
  const limit = options.limit ?? 5
  const candidates = videos.filter((v) => !isCurrentVideo(v, options))
  if (candidates.length === 0) return []

  const current =
    videos.find((v) => v.id === options.currentVideoId) ??
    (options.routeVideoKey
      ? videos.find(
          (v) => v.id === options.routeVideoKey || v.slug === options.routeVideoKey
        )
      : undefined)
  const categoryId =
    typeof current?.category_id === 'string' && current.category_id.trim()
      ? current.category_id
      : null

  if (!categoryId) return candidates.slice(0, limit)

  const sameCategory: WatchListVideo[] = []
  const other: WatchListVideo[] = []
  for (const video of candidates) {
    if (video.category_id === categoryId) sameCategory.push(video)
    else other.push(video)
  }
  return [...sameCategory, ...other].slice(0, limit)
}
