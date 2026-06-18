import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignGridPositions,
  buildHomepageRenderModel,
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
    assert.equal(model.blockItems[0]?.type, 'category_with_side_mini')
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
    assert.equal(model.blockItems[0]?.type, 'category')
    assert.equal((model.blockItems[0] as any).expandedFromHalf, true)
  })
})
