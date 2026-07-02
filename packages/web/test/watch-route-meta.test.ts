import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { routeParamMatchesVideoMeta } from '../utils/watchRouteMeta'

describe('routeParamMatchesVideoMeta', () => {
  const meta = {
    id: 'vid-123',
    slug: 'my-video-slug',
  }

  it('matches vanity slug', () => {
    assert.equal(routeParamMatchesVideoMeta('my-video-slug', meta), true)
  })

  it('matches canonical id', () => {
    assert.equal(routeParamMatchesVideoMeta('vid-123', meta), true)
  })

  it('rejects stale meta from another video', () => {
    assert.equal(routeParamMatchesVideoMeta('other-video-slug', meta), false)
  })

  it('decodes encoded route params', () => {
    assert.equal(routeParamMatchesVideoMeta(encodeURIComponent('my-video-slug'), meta), true)
  })
})
