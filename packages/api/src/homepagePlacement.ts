import { placementTimestampMs, compareVideosNewestFirst } from '@vmp/shared'

export { placementTimestampMs }

/**
 * Homepage video placement (PR B — deterministic rules engine)
 *
 * Ordering timestamp (single rule for the whole module):
 *   `placementTimestampMs` = parse(published_at) if present, else parse(upload_date).
 *   Tie-break: lexicographic `id` descending so results are stable.
 *
 * Featured hero (max one VideoRef):
 *   - `featuredMode === 'specific'` and `featuredVideoId` set → that video if it appears
 *     in the published input set; otherwise fall back as in automatic mode below.
 *   - `featuredMode === 'latest'` (automatic): if `featuredVideoIds[0]` is set (legacy) and
 *     that id is in the published set → use as pinned hero; else newest published video
 *     that has a category assignment (`category_id` non-null); if none → empty (no
 *     fallback to global newest — keeps the 2×2 grid able to show four uncategorized).
 *
 * Recent 2×2 (exactly four slots): pool = published videos without category, excluding
 *   the featured id, newest first; array length is always 4 (pad with null for empty slots
 *   if fewer than four uncategorized videos).
 *
 * Category blocks: categories ordered by `sort_order` then `name`. For each category,
 *   take published videos in that category not already assigned to featured/recent/earlier
 *   rows, sort by `direction` on the same placement timestamp, split into
 *   `visible` (first 3) and `overflow` (rest).
 *
 * Exclusivity: a video id appears at most once across featured, recent slots, and any
 *   category visible/overflow list. Priority when building: featured → recent 2×2 →
 *   categories in order.
 */

type VideoRef = { id: string }
export type PublishedVideoInput = {
  id: string
  published_at?: string | null
  upload_date?: string | null
  category_id?: string | null
}

/** Collapse duplicate join rows; prefer a row that carries a category assignment. */
export function normalizePlacementVideoRows(rows: PublishedVideoInput[]) {
  const byId = new Map<string, PublishedVideoInput>()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue
    if (!byId.has(row.id)) {
      byId.set(row.id, row)
      continue
    }
    const prev = byId.get(row.id)!
    const prevHasCat = prev.category_id != null && String(prev.category_id).trim() !== ''
    const rowHasCat = row.category_id != null && String(row.category_id).trim() !== ''
    if (!prevHasCat && rowHasCat) byId.set(row.id, row)
  }
  return [...byId.values()]
}

/** Collect every video id referenced by a placement payload. */
export function collectPlacementVideoIds(placement: {
  featured?: Array<{ id?: string } | null> | null
  recentGrid?: Array<{ id?: string } | null> | null
  categoryBlocks?: Array<{
    visible?: Array<{ id?: string } | null> | null
    overflow?: Array<{ id?: string } | null> | null
  } | null> | null
} | null) {
  const ids = new Set<string>()
  if (!placement) return []
  for (const ref of placement.featured ?? []) {
    if (ref && typeof ref.id === 'string') ids.add(ref.id)
  }
  for (const ref of placement.recentGrid ?? []) {
    if (ref && typeof ref.id === 'string') ids.add(ref.id)
  }
  for (const block of placement.categoryBlocks ?? []) {
    if (!block) continue
    for (const ref of block.visible ?? []) {
      if (ref && typeof ref.id === 'string') ids.add(ref.id)
    }
    for (const ref of block.overflow ?? []) {
      if (ref && typeof ref.id === 'string') ids.add(ref.id)
    }
  }
  return [...ids]
}
type CategoryInput = {
  id: string
  slug: string
  name: string
  sort_order: number
  direction: 'asc' | 'desc'
  homepage_layout_variant?: 'three_by_one' | 'side_mini'
}
type NormalizedCategory = CategoryInput & {
  priority_bucket: 'p0' | 'standard'
}
interface HomepageConfigInput {
  featuredMode?: unknown
  featuredVideoId?: unknown
  featuredVideoIds?: unknown
}
interface NormalizedHomepagePlacementConfig {
  featuredMode: 'latest' | 'specific'
  featuredVideoId: string | null
  featuredVideoIds: string[]
}

/**
 * Subset of persisted `admin_settings.homepage` JSON used by placement only.
 * @param {unknown} config
 */
export function normalizeHomepagePlacementConfig(config: unknown): NormalizedHomepagePlacementConfig {
  const c: HomepageConfigInput = config && typeof config === 'object' ? config as HomepageConfigInput : {}
  return {
    featuredMode: c.featuredMode === 'specific' ? 'specific' : 'latest',
    featuredVideoId: typeof c.featuredVideoId === 'string' ? c.featuredVideoId : null,
    featuredVideoIds: Array.isArray(c.featuredVideoIds)
      ? c.featuredVideoIds.filter((id): id is string => typeof id === 'string').slice(0, 4)
      : [],
  };
}

/**
 * @param {PublishedVideoInput} a
 * @param {PublishedVideoInput} b
 * @param {'asc' | 'desc'} direction
 */
function compareByDirection(a: any, b: any, direction: any) {
  const ta = placementTimestampMs(a)
  const tb = placementTimestampMs(b)
  if (direction === 'asc') {
    if (ta !== tb) return ta - tb
  } else {
    if (ta !== tb) return tb - ta
  }
  if (a.id < b.id) return direction === 'asc' ? -1 : 1
  if (a.id > b.id) return direction === 'asc' ? 1 : -1
  return 0
}

/**
 * @param {string} id
 * @param {Map<string, PublishedVideoInput>} byId
 * @returns {VideoRef | null}
 */
function refFor(id: any, byId: any) {
  const row = byId.get(id)
  return row ? { id: row.id } : null
}

/**
 * @param {{ videos: PublishedVideoInput[], categories: CategoryInput[], homepage: HomepageConfigInput }} input
 */
export function placeHomepageVideos(input: any) {
  const rawVideos = normalizePlacementVideoRows(Array.isArray(input.videos) ? input.videos : [])
  const categories = Array.isArray(input.categories) ? [...input.categories] : []
  const homepage: NormalizedHomepagePlacementConfig = input.homepage && typeof input.homepage === 'object'
    ? input.homepage
    : normalizeHomepagePlacementConfig(null)

  const byId = new Map(rawVideos.map((v) => [v.id, v]))

  const sortedAll = [...byId.values()].sort(compareVideosNewestFirst)

  const categorized = sortedAll.filter(v => v.category_id != null && v.category_id !== '')
  const mode = homepage.featuredMode === 'specific' ? 'specific' : 'latest'
  const featuredVideoId = typeof homepage.featuredVideoId === 'string' ? homepage.featuredVideoId : null
  const legacyIds = Array.isArray(homepage.featuredVideoIds) ? homepage.featuredVideoIds : []
  const legacyPin = typeof legacyIds[0] === 'string' ? legacyIds[0] : null

  /** @type {VideoRef[]} */
  let featured = []

  if (mode === 'specific' && featuredVideoId) {
    const pin = refFor(featuredVideoId, byId)
    featured = pin ? [pin] : pickAutomaticFeatured(categorized)
  } else if (mode === 'latest' && legacyPin) {
    const pin = refFor(legacyPin, byId)
    featured = pin ? [pin] : pickAutomaticFeatured(categorized)
  } else {
    featured = pickAutomaticFeatured(categorized)
  }

  const featuredId = featured[0]?.id ?? null
  const assigned = new Set()
  if (featuredId) assigned.add(featuredId)

  const uncategorizedPool = sortedAll.filter(v => (!v.category_id || v.category_id === '') && !assigned.has(v.id))
  /** @type {(VideoRef | null)[]} */
  const recentGrid = []
  for (let i = 0; i < 4; i += 1) {
    const v = uncategorizedPool[i]
    if (v) {
      recentGrid.push({ id: v.id })
      assigned.add(v.id)
    } else {
      recentGrid.push(null)
    }
  }

  const orderedCategories = sortCategoriesForHomepage(categories)

  /** @type {Array<{ category: { id: string, slug: string, name: string, direction: 'asc' | 'desc' }, visible: VideoRef[], overflow: VideoRef[] }>} */
  const categoryBlocks = []

  for (const cat of orderedCategories) {
    if (!cat || typeof cat.id !== 'string') continue
    const direction = cat.direction === 'asc' ? 'asc' : 'desc'
    const inCat = sortedAll
      .filter(v => v.category_id === cat.id && !assigned.has(v.id))
      .sort((a, b) => compareByDirection(a, b, direction))

    const visibleRaw = inCat.slice(0, 3)
    const overflowRaw = inCat.slice(3)

    const visible = visibleRaw.map(v => ({ id: v.id }))
    const overflow = overflowRaw.map(v => ({ id: v.id }))

    for (const v of visibleRaw) assigned.add(v.id)
    for (const v of overflowRaw) assigned.add(v.id)

    categoryBlocks.push({
      category: {
        id: cat.id,
        slug: typeof cat.slug === 'string' ? cat.slug : '',
        name: typeof cat.name === 'string' ? cat.name : '',
        direction,
        sort_order: Number.isInteger(cat.sort_order) ? cat.sort_order : 0,
        priority_bucket: cat.priority_bucket,
        homepage_layout_variant: cat.homepage_layout_variant === 'side_mini' ? 'side_mini' : 'three_by_one',
      },
      visible,
      overflow,
    })
  }

  return { featured, recentGrid, categoryBlocks }
}

/**
 * Canonical category ordering for homepage rendering:
 *   1) P0 categories first (`sort_order <= 0`)
 *   2) then ascending `sort_order`
 *   3) then name/id for stable ties
 */
export function sortCategoriesForHomepage(categories: any[]) {
  const normalized = categories
    .filter((cat) => cat && typeof cat.id === 'string')
    .map((cat) => {
      const sortOrder = Number.isInteger(cat.sort_order) ? cat.sort_order : 0
      return {
        ...cat,
        sort_order: sortOrder,
        priority_bucket: sortOrder <= 0 ? 'p0' : 'standard',
      } as NormalizedCategory
    })

  normalized.sort((a, b) => {
    const aTier = a.priority_bucket === 'p0' ? 0 : 1
    const bTier = b.priority_bucket === 'p0' ? 0 : 1
    if (aTier !== bTier) return aTier - bTier
    const so = a.sort_order - b.sort_order
    if (so !== 0) return so
    const an = typeof a.name === 'string' ? a.name : ''
    const bn = typeof b.name === 'string' ? b.name : ''
    if (an < bn) return -1
    if (an > bn) return 1
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })

  return normalized
}

/**
 * Newest categorized published video, or empty if none.
 * @param {PublishedVideoInput[]} categorizedSorted
 */
function pickAutomaticFeatured(categorizedSorted: any) {
  if (categorizedSorted.length) {
    const top = categorizedSorted[0]
    return top ? [{ id: top.id }] : []
  }
  return []
}
