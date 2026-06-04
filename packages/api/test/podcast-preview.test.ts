import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isFullPublicPreview, needsPodcastPreviewMp3 } from '../src/podcastPreview.js'

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
})
