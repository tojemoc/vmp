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
  rightRailWithNextSideMini?: boolean
  width?: 'full' | 'half'
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

export function orderLayoutBlocksForViewport(
  blocks: HomepageLayoutBlock[],
  isMobile: boolean,
): HomepageLayoutBlock[] {
  if (!isMobile) return blocks
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

export function buildHomepageRenderModel({
  videos,
  layoutBlocks,
  placement,
}: {
  videos: any[]
  layoutBlocks: HomepageLayoutBlock[]
  placement: HomepagePlacementResponse | null
}) {
  const safeLayoutBlocks = Array.isArray(layoutBlocks) ? layoutBlocks : []
  const renderedBlocks = safeLayoutBlocks
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

  const buildLeafBlock = (block: HomepageLayoutChildBlock, id: string): HomepageRenderLeafBlock | null => {
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

  const blockItems: HomepageRenderBlock[] = []
  for (let idx = 0; idx < renderedBlocks.length; idx += 1) {
    const block = renderedBlocks[idx]
    if (!block) continue
    const blockType = block?.type
    if (blockType === 'split_horizontal' || blockType === 'split_vertical') {
      const children = Array.isArray(block?.childBlocks)
        ? block.childBlocks
          .map((child, childIdx) => buildLeafBlock(child, `${block.id}:child:${childIdx}`))
          .filter((child): child is HomepageRenderLeafBlock => Boolean(child))
          .slice(0, 2)
        : []
      blockItems.push({
        id: block.id,
        type: blockType,
        title: typeof block?.title === 'string' ? block.title : '',
        body: typeof block?.body === 'string' ? block.body : '',
        children,
      } as HomepageRenderSplitBlock)
      continue
    }
    const leaf = buildLeafBlock(block as HomepageLayoutChildBlock, block.id)
    if (!leaf) continue
    const shouldPairRightRail = blockType === 'category' && block?.rightRailWithNextSideMini === true
    if (shouldPairRightRail) {
      const next = renderedBlocks[idx + 1]
      const nextLeaf = next ? buildLeafBlock(next as HomepageLayoutChildBlock, next.id) : null
      const nextIsSideMiniCategory = next?.type === 'category' && nextLeaf?.categorySection?.variant === 'side_mini'
      if (nextIsSideMiniCategory && nextLeaf) {
        const primaryCategorySection = leaf.categorySection
        const pairedPrimary: HomepageRenderLeafBlock = {
          ...leaf,
          categorySection: primaryCategorySection ? {
            ...primaryCategorySection,
            visible: primaryCategorySection.allVideos.slice(0, 4),
            overflowCount: Math.max(0, primaryCategorySection.allVideos.length - 4),
          } : null,
        }
        blockItems.push({
          id: `${leaf.id}:right-rail`,
          type: 'category_with_side_mini',
          title: leaf.title,
          body: leaf.body,
          primary: pairedPrimary,
          sideMini: nextLeaf,
        })
        idx += 1
        continue
      }
    }
    blockItems.push(leaf)
  }

  const hasFeaturedRowBlock = blockItems.some((item: any) =>
    item?.type === 'featured_row'
    || (item?.type === 'split_horizontal' || item?.type === 'split_vertical')
      && Array.isArray(item?.children)
      && item.children.some((child: HomepageRenderLeafBlock) => child.type === 'featured_row'),
  )

  return {
    renderedBlocks,
    featuredVideos,
    categorySections,
    blockItems,
    hasFeaturedRowBlock,
    topVideo,
  }
}