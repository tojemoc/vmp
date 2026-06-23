import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignGridPositions,
  buildHomepageRenderModel,
  orderLayoutBlocksForViewport,
  validateGridPositions,
} from '../composables/useHomepageLayout'

describe('assignGridPositions', () => {
  it('places full-width blocks on their own row', () => {
    const blocks = assignGridPositions([
      { id: 'a', type: 'top_video', width: 'full' },
      { id: 'b', type: 'category', width: 'half' },
      { id: 'c', type: 'category', width: 'half' },
    ] as any)
    assert.deepEqual(blocks.map((block) => [block.id, block.gridRow, block.gridCol, block.width]), [
      ['a', 0, 0, 'full'],
      ['b', 1, 0, 'half'],
      ['c', 1, 1, 'half'],
    ])
  })

  it('starts a full-width block on a new row when the previous half filled column 1', () => {
    const blocks = assignGridPositions([
      { id: 'half', type: 'category', width: 'half' },
      { id: 'full', type: 'top_video', width: 'full' },
    ] as any)
    assert.deepEqual(blocks.map((block) => [block.id, block.gridRow, block.gridCol, block.width]), [
      ['half', 0, 0, 'half'],
      ['full', 1, 0, 'full'],
    ])
  })

  it('honours explicit full width on category blocks', () => {
    const blocks = assignGridPositions([
      { id: 'cat', type: 'category', width: 'full' },
      { id: 'half', type: 'category', width: 'half' },
    ] as any)
    assert.deepEqual(blocks.map((block) => [block.id, block.gridRow, block.gridCol, block.width]), [
      ['cat', 0, 0, 'full'],
      ['half', 1, 0, 'half'],
    ])
  })
})

describe('validateGridPositions', () => {
  it('rejects duplicate row/column pairs', () => {
    const message = validateGridPositions([
      { id: 'a', type: 'category', width: 'half', gridRow: 0, gridCol: 0 },
      { id: 'b', type: 'category', width: 'half', gridRow: 0, gridCol: 0 },
    ] as any)
    assert.match(message ?? '', /share row 0, column 0/)
  })
})

describe('orderLayoutBlocksForViewport', () => {
  it('filters hidden blocks and sorts by mobileOrder on mobile', () => {
    const blocks = assignGridPositions([
      { id: 'a', type: 'top_video', width: 'full', mobileOrder: 2 },
      { id: 'b', type: 'category', width: 'half', mobileOrder: 0, mobileHidden: true },
      { id: 'c', type: 'category', width: 'half', mobileOrder: 1 },
    ] as any)
    const mobile = orderLayoutBlocksForViewport(blocks, true)
    assert.deepEqual(mobile.map((block) => block.id), ['c', 'a'])
  })
})

describe('buildHomepageRenderModel grid rows', () => {
  const videos = [
    { id: 'v1', title: 'One', upload_date: '2026-01-01T00:00:00Z' },
    { id: 'v2', title: 'Two', upload_date: '2026-01-02T00:00:00Z' },
    { id: 'v3', title: 'Three', upload_date: '2026-01-03T00:00:00Z' },
    { id: 'v4', title: 'Four', upload_date: '2026-01-04T00:00:00Z' },
    { id: 'v5', title: 'Five', upload_date: '2026-01-05T00:00:00Z' },
  ]

  const placement = {
    featured: [{ id: 'v2' }, { id: 'v3' }, { id: 'v4' }, { id: 'v5' }],
    recentGrid: [],
    categoryBlocks: [
      {
        category: { id: 'cat-main', slug: 'main', name: 'Main', homepage_layout_variant: 'three_by_one' },
        visible: [{ id: 'v2' }, { id: 'v3' }, { id: 'v4' }],
        overflow: [{ id: 'v5' }],
      },
      {
        category: { id: 'cat-side', slug: 'side', name: 'Side', homepage_layout_variant: 'side_mini' },
        visible: [{ id: 'v3' }, { id: 'v4' }],
        overflow: [],
      },
      {
        category: { id: 'cat-empty', slug: 'empty', name: 'Empty', homepage_layout_variant: 'three_by_one' },
        visible: [],
        overflow: [],
      },
    ],
  }

  it('pairs two half category blocks on the same row', () => {
    const model = buildHomepageRenderModel({
      videos,
      layoutBlocks: assignGridPositions([
        { id: 'left', type: 'category', width: 'half', categoryId: 'cat-main' },
        { id: 'right', type: 'category', width: 'half', categoryId: 'cat-side' },
      ] as any),
      placement: placement as any,
    })
    assert.equal(model.blockItems.length, 1)
    const paired = model.blockItems[0] as any
    assert.equal(paired.type, 'category_with_side_mini')
    assert.equal(paired.primary.categoryId, 'cat-main')
    assert.equal(paired.sideMini.categoryId, 'cat-side')
    assert.equal(paired.primary.categorySection.allVideos.length, 4)
    assert.equal(paired.primary.categorySection.visible.length, 4)
    assert.equal(paired.sideMini.categorySection.visible.length, 2)
  })

  it('hides empty categories and expands the visible half block', () => {
    const model = buildHomepageRenderModel({
      videos,
      layoutBlocks: assignGridPositions([
        { id: 'left', type: 'category', width: 'half', categoryId: 'cat-main' },
        { id: 'right', type: 'category', width: 'half', categoryId: 'cat-empty' },
      ] as any),
      placement: placement as any,
    })
    assert.equal(model.blockItems.length, 1)
    const block = model.blockItems[0] as any
    assert.equal(block.type, 'category')
    assert.equal(block.expandedFromHalf, true)
    assert.equal(block.categoryId, 'cat-main')
    assert.equal(block.categorySection.category.id, 'cat-main')
    assert.ok(block.categorySection.visible.length > 0)
    assert.equal(model.blockItems.some((item: any) => item.categoryId === 'cat-empty'), false)
  })

  it('renders both row blocks when pairing fails but both are visible', () => {
    const splitPlacement = {
      featured: [{ id: 'v2' }],
      recentGrid: [],
      categoryBlocks: [{
        category: { id: 'cat-side', slug: 'side', name: 'Side', homepage_layout_variant: 'side_mini' },
        visible: [{ id: 'v3' }, { id: 'v4' }],
        overflow: [],
      }],
    }
    const model = buildHomepageRenderModel({
      videos,
      layoutBlocks: assignGridPositions([
        { id: 'left', type: 'category', width: 'half', categoryId: 'cat-side' },
        { id: 'right', type: 'featured_row', width: 'half' },
      ] as any),
      placement: splitPlacement as any,
    })
    assert.equal(model.blockItems.length, 2)
    assert.equal(model.blockItems[0]?.type, 'category')
    assert.equal(model.blockItems[1]?.type, 'featured_row')
  })

  it('does not hide the global newest video from categories when no top_video block exists', () => {
    const newestVideo = { id: 'v-newest', title: 'Newest', upload_date: '2026-02-01T00:00:00Z', published_at: '2026-02-01T00:00:00Z' }
    const placementWithNewestFeatured = {
      featured: [{ id: 'v-newest' }],
      recentGrid: [null, null, null, null],
      categoryBlocks: [{
        category: { id: 'cat-main', slug: 'main', name: 'Main', homepage_layout_variant: 'three_by_one' },
        visible: [{ id: 'v2' }, { id: 'v3' }],
        overflow: [],
      }],
    }
    const model = buildHomepageRenderModel({
      videos: [...videos, newestVideo],
      layoutBlocks: assignGridPositions([
        { id: 'featured', type: 'featured_row', width: 'full' },
        { id: 'cat', type: 'category', width: 'full', categoryId: 'cat-main' },
      ] as any),
      placement: placementWithNewestFeatured as any,
    })
    const featured = model.blockItems.find((item: any) => item.type === 'featured_row') as any
    assert.ok(featured?.videos?.some((video: any) => video.id === 'v-newest'))
  })

  it('suppresses duplicate global newest video elsewhere only when a top_video block exists', () => {
    const newestVideo = { id: 'v5', title: 'Five', upload_date: '2026-01-05T00:00:00Z', published_at: '2026-01-05T00:00:00Z' }
    const model = buildHomepageRenderModel({
      videos: [...videos, newestVideo],
      layoutBlocks: assignGridPositions([
        { id: 'top', type: 'top_video', width: 'full' },
        { id: 'featured', type: 'featured_row', width: 'full' },
      ] as any),
      placement: {
        featured: [{ id: 'v5' }],
        recentGrid: [null, null, null, null],
        categoryBlocks: [],
      } as any,
    })
    const top = model.blockItems.find((item: any) => item.type === 'top_video') as any
    const featured = model.blockItems.find((item: any) => item.type === 'featured_row') as any
    assert.equal(top?.videos?.[0]?.id, 'v5')
    assert.equal(featured?.videos?.length ?? 0, 0)
  })

  it('suppresses featured videos from categories only when a featured_row block exists', () => {
    const pinned = { id: 'v-pin', title: 'Pinned', upload_date: '2026-02-01T00:00:00Z', published_at: '2026-02-01T00:00:00Z' }
    const placement = {
      featured: [{ id: 'v-pin' }],
      recentGrid: [],
      categoryBlocks: [{
        category: { id: 'cat-main', slug: 'main', name: 'Main', homepage_layout_variant: 'three_by_one' },
        visible: [{ id: 'v2' }, { id: 'v3' }],
        overflow: [],
      }],
    }
    const withFeaturedRow = buildHomepageRenderModel({
      videos: [...videos, pinned],
      layoutBlocks: assignGridPositions([
        { id: 'featured', type: 'featured_row', width: 'full' },
        { id: 'cat', type: 'category', width: 'full', categoryId: 'cat-main' },
      ] as any),
      placement: placement as any,
    })
    const featured = withFeaturedRow.blockItems.find((item: any) => item.type === 'featured_row') as any
    const category = withFeaturedRow.blockItems.find((item: any) => item.type === 'category') as any
    assert.equal(featured?.videos?.[0]?.id, 'v-pin')
    assert.equal(category?.categorySection?.visible.some((video: any) => video.id === 'v-pin'), false)

    const withoutFeaturedRow = buildHomepageRenderModel({
      videos: [...videos, pinned],
      layoutBlocks: assignGridPositions([
        { id: 'cat', type: 'category', width: 'full', categoryId: 'cat-main' },
      ] as any),
      placement: {
        ...placement,
        featured: [],
        categoryBlocks: [{
          ...placement.categoryBlocks[0],
          visible: [{ id: 'v-pin' }, { id: 'v2' }, { id: 'v3' }],
        }],
      } as any,
    })
    const loneCategory = withoutFeaturedRow.blockItems.find((item: any) => item.type === 'category') as any
    assert.ok(loneCategory?.categorySection?.visible.some((video: any) => video.id === 'v-pin'))
  })
})
