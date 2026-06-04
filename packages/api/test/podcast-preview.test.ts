import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PREVIEW_FULL_UNLOCK_EPSILON_SEC,
  isFullPublicPreview,
  needsPodcastPreviewMp3,
} from '../src/podcastPreview.js'

describe('podcastPreview', () => {
  it('treats preview at full duration as full unlock', () => {
    assert.equal(isFullPublicPreview(358, 358), true)
    assert.equal(needsPodcastPreviewMp3(358, 358), false)
  })

  it('needs trimmed preview when preview is shorter than full', () => {
    assert.equal(needsPodcastPreviewMp3(180, 358), true)
    assert.equal(isFullPublicPreview(180, 358), false)
  })

  it('does not need preview MP3 when preview is zero', () => {
    assert.equal(needsPodcastPreviewMp3(0, 358), false)
  })

  it('treats preview at full minus epsilon as full unlock', () => {
    const fullDuration = 358
    const previewDuration = fullDuration - PREVIEW_FULL_UNLOCK_EPSILON_SEC
    assert.equal(isFullPublicPreview(previewDuration, fullDuration), true)
    assert.equal(needsPodcastPreviewMp3(previewDuration, fullDuration), false)
  })

  it('needs trimmed preview just below full-minus-epsilon threshold', () => {
    const fullDuration = 358
    const previewDuration = fullDuration - PREVIEW_FULL_UNLOCK_EPSILON_SEC - 0.001
    assert.equal(isFullPublicPreview(previewDuration, fullDuration), false)
    assert.equal(needsPodcastPreviewMp3(previewDuration, fullDuration), true)
  })
})
