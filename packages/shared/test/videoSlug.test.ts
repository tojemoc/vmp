import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalWatchToken,
  isValidVideoSlug,
  sanitizeVideoSlug,
  transliterateToAscii,
} from '../src/videoSlug.js'

describe('sanitizeVideoSlug', () => {
  it('transliterates Slovak/Czech diacritics and uses hyphens for spaces', () => {
    assert.equal(sanitizeVideoSlug('Môj článok'), 'moj-clanok')
    assert.equal(sanitizeVideoSlug('čťáíý'), 'ctaiy')
    assert.equal(sanitizeVideoSlug('Video o víne'), 'video-o-vine')
  })

  it('collapses repeated separators', () => {
    assert.equal(sanitizeVideoSlug('  foo   bar  '), 'foo-bar')
    assert.equal(sanitizeVideoSlug('foo---bar'), 'foo-bar')
  })

  it('returns empty for invalid input', () => {
    assert.equal(sanitizeVideoSlug(''), '')
    assert.equal(sanitizeVideoSlug(null), '')
  })
})

describe('transliterateToAscii', () => {
  it('maps accented Latin letters to base forms', () => {
    assert.equal(transliterateToAscii('č'), 'c')
    assert.equal(transliterateToAscii('ť'), 't')
    assert.equal(transliterateToAscii('á'), 'a')
    assert.equal(transliterateToAscii('í'), 'i')
    assert.equal(transliterateToAscii('ý'), 'y')
  })
})

describe('isValidVideoSlug', () => {
  it('accepts lowercase hyphenated slugs', () => {
    assert.equal(isValidVideoSlug('my-video'), true)
    assert.equal(isValidVideoSlug('My-Video'), false)
    assert.equal(isValidVideoSlug('-bad'), false)
  })
})

describe('canonicalWatchToken', () => {
  it('prefers slug over id', () => {
    assert.equal(canonicalWatchToken({ id: 'abc', slug: 'my-video' }), 'my-video')
    assert.equal(canonicalWatchToken({ id: 'abc', slug: null }), 'abc')
  })
})
