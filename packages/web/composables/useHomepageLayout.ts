import { compareVideosNewestFirst } from '@vmp/shared'

export type HomepageBlockType = 'featured_row' | 'category' | 'top_video' | 'split_horizontal' | 'split_vertical'
export type HomepageLeafBlockType = 'featured_row' | 'category' | 'top_video'

export interface HomepageLayoutChildBlock {
  id?: string
  type: HomepageLeafBlockType
  title?: string
  body?: string
  categoryId?: string | null
}

export interface HomepageLayoutBlock {
  id: string
  type: HomepageBlockType
  title?: string
  body?: string
  categoryId?: string | null
  /** @deprecated Pairing is inferred from gridRow/gridCol + width; kept for backwards-compatible loads. */
  rightRailWithNextSideMini?: boolean
  width?: 'full' | 'half'
  gridRow?: number
  gridCol?: number
  mobileHidden?: boolean
  mobileOrder?: number
  childBlocks?: HomepageLayoutChildBlock[]
}

export interface HomepageCategory {
  id: string
  slug: string
  name: string
  direction?: 'asc' | 'desc'
  sort_order?: number
  priority_bucket?: 'p0' | 'standard'
  homepage_layout_variant?: 'three_by_one' | 'side_mini'
}

export interface HomepagePlacementResponse {
  featured: Array<{ id: string }>
  recentGrid: Array<{ id: string } | null>
  categoryBlocks: Array<{
    category: HomepageCategory
    visible: Array<{ id: string }>
    overflow: Array<{ id: string }>
  }>
}

export interface HomepageRenderLeafBlock {
  id: string
  type: HomepageLeafBlockType
  title: string
  body: string
  categoryId: string | null
  videos: any[]
  categorySection: {
    category: HomepageCategory
    allVideos: any[]
    visible: any[]
    overflowCount: number
    variant: 'three_by_one' | 'side_mini'
  } | null
  /** Half-width block rendered alone because its row partner is empty/hidden. */
  expandedFromHalf?: boolean
}

export interface HomepageRenderSplitBlock {
  id: string
  type: 'split_horizontal' | 'split_vertical'
  title: string
  body: string
  children: HomepageRenderLeafBlock[]
}

export interface HomepageRenderCategoryPairBlock {
  id: string
  type: 'category_with_side_mini'
  title: string
  body: string
  primary: HomepageRenderLeafBlock
  sideMini: HomepageRenderLeafBlock
}

export type HomepageRenderBlock = HomepageRenderLeafBlock | HomepageRenderSplitBlock | HomepageRenderCategoryPairBlock

export function isSplitRenderBlock(block: HomepageRenderBlock): block is HomepageRenderSplitBlock {
  return block.type === 'split_horizontal' || block.type === 'split_vertical'
}

export function isLeafRenderBlock(block: HomepageRenderBlock): block is HomepageRenderLeafBlock {
  return block.type === 'featured_row' || block.type === 'category' || block.type === 'top_video'
}

function defaultBlockWidth(type: HomepageBlockType): 'full' | 'half' {
  if (type === 'featured_row' || type === 'top_video') return 'full'
  return 'half'
}

function resolveBlockWidth(block: HomepageLayoutBlock): 'full' | 'half' {
  if (block.width === 'full' || block.width === 'half') return block.width
  return defaultBlockWidth(block.type)
}

/** Assign row/column positions from block order and width. Full-width blocks occupy a row alone. */
export function assignGridPositions(blocks: HomepageLayoutBlock[]): HomepageLayoutBlock[] {
  let row = 0
  let col = 0
  return blocks.map((block) => {
    const width = resolveBlockWidth(block)
    if (width === 'full') {
      if (col === 1) {
        row += 1
        col = 0
      }
      const next = { ...block, width: 'full' as const, gridRow: row, gridCol: 0 }
      row += 1
      col = 0
      return next
    }
    const next = { ...block, width: 'half' as const, gridRow: row, gridCol: col }
    if (col === 0) col = 1
    else {
      row += 1
      col = 0
    }
    return next
  })
}

export function ensureBlockGridPositions(blocks: HomepageLayoutBlock[]): HomepageLayoutBlock[] {
  if (!blocks.length) return []
  const needsAssign = blocks.some((block) => !Number.isFinite(Number(block.gridRow)) || !Number.isFinite(Number(block.gridCol)))
  return needsAssign ? assignGridPositions(blocks) : blocks.map((block) => ({
    ...block,
    gridRow: Number(block.gridRow),
    gridCol: Number(block.gridCol),
  }))
}

export function validateGridPositions(blocks: HomepageLayoutBlock[]): string | null {
  const positioned = ensureBlockGridPositions(blocks)
  const seen = new Set<string>()
  for (const block of positioned) {
    const key = `${block.gridRow}:${block.gridCol}`
    if (seen.has(key)) {
      return `Two homepage blocks share row ${block.gridRow}, column ${block.gridCol}.`
    }
    seen.add(key)
    if (block.gridCol !== 0 && block.gridCol !== 1) {
      return `Block ${block.id} has invalid gridCol ${block.gridCol}.`
    }
    if (block.width === 'full' && block.gridCol !== 0) {
      return `Full-width block ${block.id} must use column 0.`
    }
  }
  return null
}

export function orderBlocksByGrid(blocks: HomepageLayoutBlock[]): HomepageLayoutBlock[] {
  return [...ensureBlockGridPositions(blocks)].sort((a, b) => {
    const rowDiff = Number(a.gridRow) - Number(b.gridRow)
    if (rowDiff !== 0) return rowDiff
    return Number(a.gridCol) - Number(b.gridCol)
  })
}

export function rowPartnerBlock(blocks: HomepageLayoutBlock[], block: HomepageLayoutBlock): HomepageLayoutBlock | null {
  const positioned = ensureBlockGridPositions(blocks)
  const row = Number(block.gridRow)
  const col = Number(block.gridCol)
  const partnerCol = col === 0 ? 1 : 0
  return positioned.find((candidate) => Number(candidate.gridRow) === row && Number(candidate.gridCol) === partnerCol) ?? null
}

export function blockWouldExpandToFullWidth(blocks: HomepageLayoutBlock[], block: HomepageLayoutBlock): boolean {
  if (block.width !== 'half') return false
  const partner = rowPartnerBlock(blocks, block)
  if (!partner) return true
  if (partner.type === 'category' && (!partner.categoryId || partner.categoryId.trim() === '')) return true
  return false
}

export function orderLayoutBlocksForViewport(
  blocks: HomepageLayoutBlock[],
  isMobile: boolean,
): HomepageLayoutBlock[] {
  if (!isMobile) return orderBlocksByGrid(blocks)
  return blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.mobileHidden !== true)
    .sort((a, b) => {
      const ao = Number.isFinite(Number(a.block.mobileOrder)) ? Number(a.block.mobileOrder) : a.index
      const bo = Number.isFinite(Number(b.block.mobileOrder)) ? Number(b.block.mobileOrder) : b.index
      return ao - bo
    })
    .map(({ block }) => block)
}

function leafHasRenderableContent(leaf: HomepageRenderLeafBlock | null): boolean {
  if (!leaf) return false
  if (leaf.type === 'category') return Boolean(leaf.categorySection?.allVideos.length)
  return leaf.videos.length > 0
}

export function buildHomepageRenderModel({
  videos,
  layoutBlocks,
  placement,
}: {
  videos: any[]
  layoutBlocks: HomepageLayoutBlock[]
  placement: HomepagePlacementResponse | null
}) {
  const positionedBlocks = orderBlocksByGrid(Array.isArray(layoutBlocks) ? layoutBlocks : [])
  const videoById = new Map((videos ?? []).map((video) => [video.id, video]))
  const sortedByNewest = [...videoById.values()].sort((a: any, b: any) => compareVideosNewestFirst(a, b))
  const topVideo = sortedByNewest[0] ?? null
  const topVideoId = topVideo?.id ?? null

  const featuredIdList = Array.isArray(placement?.featured)
    ? placement.featured.map((ref) => ref?.id).filter(Boolean).filter((id) => id !== topVideoId)
    : []
  const featuredVideos = featuredIdList
    .slice(0, 4)
    .map((id) => videoById.get(id))
    .filter(Boolean)

  const categorySections = (placement?.categoryBlocks ?? []).map((block) => {
    const combinedIds = [...block.visible, ...block.overflow]
      .map((ref) => ref.id)
      .filter((id) => id !== topVideoId)
    const allVideos = combinedIds.map((id) => videoById.get(id)).filter(Boolean)
    const variant = block.category?.homepage_layout_variant === 'side_mini' ? 'side_mini' : 'three_by_one'
    const visibleCount = variant === 'side_mini' ? 2 : 3
    return {
      category: block.category,
      allVideos,
      visible: allVideos.slice(0, visibleCount),
      overflowCount: Math.max(0, allVideos.length - visibleCount),
      variant: variant as 'three_by_one' | 'side_mini',
    }
  }).filter((section) => section.allVideos.length > 0)

  const sectionByCategoryId = new Map(categorySections.map((section) => [section.category.id, section]))

  const buildLeafBlock = (block: HomepageLayoutChildBlock | HomepageLayoutBlock, id: string): HomepageRenderLeafBlock | null => {
    const type = block?.type
    if (type !== 'featured_row' && type !== 'category' && type !== 'top_video') return null
    const title = typeof block?.title === 'string' ? block.title : ''
    const body = typeof block?.body === 'string' ? block.body : ''
    const categoryId = typeof block?.categoryId === 'string' && block.categoryId.trim() ? block.categoryId : null
    if (type === 'featured_row') {
      return {
        id,
        type,
        title,
        body,
        categoryId: null,
        videos: featuredVideos.slice(0, 4),
        categorySection: null,
      }
    }
    if (type === 'top_video') {
      return {
        id,
        type,
        title,
        body,
        categoryId: null,
        videos: topVideo ? [topVideo] : [],
        categorySection: null,
      }
    }
    const section = categoryId ? sectionByCategoryId.get(categoryId) ?? null : null
    return {
      id,
      type,
      title,
      body,
      categoryId,
      videos: section?.allVideos ?? [],
      categorySection: section,
    }
  }

  const rows = new Map<number, HomepageLayoutBlock[]>()
  for (const block of positionedBlocks) {
    const row = Number(block.gridRow)
    if (!rows.has(row)) rows.set(row, [])
    rows.get(row)!.push(block)
  }

  const blockItems: HomepageRenderBlock[] = []
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const rowBlocks = (rows.get(row) ?? []).sort((a, b) => Number(a.gridCol) - Number(b.gridCol))
    const fullBlock = rowBlocks.find((block) => block.width === 'full')
    if (fullBlock) {
      if (fullBlock.type === 'split_horizontal' || fullBlock.type === 'split_vertical') {
        const children = Array.isArray(fullBlock.childBlocks)
          ? fullBlock.childBlocks
            .map((child, childIdx) => buildLeafBlock(child, `${fullBlock.id}:child:${childIdx}`))
            .filter((child): child is HomepageRenderLeafBlock => Boolean(child))
            .slice(0, 2)
          : []
        blockItems.push({
          id: fullBlock.id,
          type: fullBlock.type,
          title: typeof fullBlock.title === 'string' ? fullBlock.title : '',
          body: typeof fullBlock.body === 'string' ? fullBlock.body : '',
          children,
        })
        continue
      }
      const leaf = buildLeafBlock(fullBlock, fullBlock.id)
      if (leaf && leafHasRenderableContent(leaf)) blockItems.push(leaf)
      continue
    }

    const leftConfig = rowBlocks.find((block) => Number(block.gridCol) === 0)
    const rightConfig = rowBlocks.find((block) => Number(block.gridCol) === 1)
    const leftLeaf = leftConfig ? buildLeafBlock(leftConfig, leftConfig.id) : null
    const rightLeaf = rightConfig ? buildLeafBlock(rightConfig, rightConfig.id) : null
    const leftVisible = leafHasRenderableContent(leftLeaf)
    const rightVisible = leafHasRenderableContent(rightLeaf)

    if (leftVisible && rightVisible && leftLeaf && rightLeaf && leftLeaf.type === 'category' && rightLeaf.type === 'category') {
      const pairedPrimary: HomepageRenderLeafBlock = leftLeaf.type === 'category' && leftLeaf.categorySection
        ? {
          ...leftLeaf,
          categorySection: {
            ...leftLeaf.categorySection,
            visible: leftLeaf.categorySection.allVideos.slice(0, 4),
            overflowCount: Math.max(0, leftLeaf.categorySection.allVideos.length - 4),
          },
        }
        : leftLeaf
      const sideMini: HomepageRenderLeafBlock = rightLeaf.type === 'category' && rightLeaf.categorySection
        ? {
          ...rightLeaf,
          categorySection: {
            ...rightLeaf.categorySection,
            variant: 'side_mini',
            visible: rightLeaf.categorySection.allVideos.slice(0, 2),
            overflowCount: Math.max(0, rightLeaf.categorySection.allVideos.length - 2),
          },
        }
        : rightLeaf
      blockItems.push({
        id: `${leftLeaf.id}:row-${row}`,
        type: 'category_with_side_mini',
        title: leftLeaf.title,
        body: leftLeaf.body,
        primary: pairedPrimary,
        sideMini,
      })
      continue
    }

    if (leftVisible && leftLeaf) {
      blockItems.push({ ...leftLeaf, expandedFromHalf: leftConfig?.width === 'half' && !rightVisible })
    }
    if (rightVisible && rightLeaf) {
      blockItems.push({ ...rightLeaf, expandedFromHalf: rightConfig?.width === 'half' && !leftVisible })
    }
  }

  const hasFeaturedRowBlock = blockItems.some((item: any) =>
    item?.type === 'featured_row'
    || (item?.type === 'split_horizontal' || item?.type === 'split_vertical')
      && Array.isArray(item?.children)
      && item.children.some((child: HomepageRenderLeafBlock) => child.type === 'featured_row'),
  )

  return {
    renderedBlocks: positionedBlocks,
    featuredVideos,
    categorySections,
    blockItems,
    hasFeaturedRowBlock,
    topVideo,
  }
}
