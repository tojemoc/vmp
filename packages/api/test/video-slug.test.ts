/**
 * Video slug sanitization (shared with @vmp/shared).
 * Run: npm test --workspace=@vmp/api
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeVideoSlug } from '@vmp/shared'

describe('sanitizeVideoSlug (API contract)', () => {
  it('transliterates diacritics instead of replacing them with dashes', () => {
    assert.equal(sanitizeVideoSlug('článok o víne'), 'clanok-o-vine')
    assert.equal(sanitizeVideoSlug('čťáíý'), 'ctaiy')
  })
})
