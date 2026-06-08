import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapRecommendationVideoRow, scoreRecommendationVideos } from '../src/recommendations.js'

describe('scoreRecommendationVideos', () => {
  const videos = [
    { id: 'current', category_id: 'cat-a', published_at: '2026-06-01T00:00:00Z', view_count: 100 },
    { id: 'new-hot', category_id: 'cat-a', published_at: '2026-06-07T00:00:00Z', view_count: 10 },
    { id: 'old-low', category_id: 'cat-a', published_at: '2026-01-01T00:00:00Z', view_count: 2 },
    { id: 'other-cat', category_id: 'cat-b', published_at: '2026-06-06T00:00:00Z', view_count: 50 },
  ]

  it('prefers recent videos when recency bias is high', () => {
    const ranked = scoreRecommendationVideos(videos, 'current', {
      recencyBias: 2,
      lowViewsBoost: 0,
      categoryLock: false,
    })
    assert.equal(ranked[0]?.id, 'new-hot')
  })

  it('boosts lower view-count videos when configured', () => {
    const ranked = scoreRecommendationVideos(videos, 'current', {
      recencyBias: 0,
      lowViewsBoost: 2,
      categoryLock: true,
    })
    assert.equal(ranked[0]?.id, 'old-low')
  })

  it('locks recommendations to the current category', () => {
    const ranked = scoreRecommendationVideos(videos, 'current', {
      recencyBias: 1,
      lowViewsBoost: 0,
      categoryLock: true,
    })
    assert.ok(ranked.every((v) => v.category_id === 'cat-a'))
  })

  it('mapRecommendationVideoRow includes UI fields for watch cards', () => {
    const mapped = mapRecommendationVideoRow({
      id: 'vid-1',
      slug: 'my-slug',
      title: 'Example title',
      description: 'Example description',
      thumbnail_url: 'https://cdn.example/thumb.jpg',
      full_duration: 3600,
      preview_duration: 120,
      category_id: 'cat-a',
      view_count: 12,
    })
    assert.equal(mapped.id, 'vid-1')
    assert.equal(mapped.title, 'Example title')
    assert.equal(mapped.thumbnail_url, 'https://cdn.example/thumb.jpg')
    assert.equal(mapped.full_duration, 3600)
    assert.equal(mapped.category_id, 'cat-a')
  })
})
