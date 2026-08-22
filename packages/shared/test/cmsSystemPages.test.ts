import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CMS_FOOTER_PAGE_ID,
  CMS_PERSONAL_DATA_PAGE_ID,
  isCmsPageIdPathSegment,
} from '../src/cmsSystemPages.js';

describe('isCmsPageIdPathSegment', () => {
  it('accepts UUID page ids including the footer system page', () => {
    assert.equal(isCmsPageIdPathSegment(CMS_FOOTER_PAGE_ID), true);
    assert.equal(isCmsPageIdPathSegment('550e8400-e29b-41d4-a716-446655440000'), true);
  });

  it('accepts stable cms-page-* system ids', () => {
    assert.equal(isCmsPageIdPathSegment(CMS_PERSONAL_DATA_PAGE_ID), true);
    assert.equal(isCmsPageIdPathSegment('cms-page-example'), true);
  });

  it('rejects public slugs so GET-by-slug still works', () => {
    assert.equal(isCmsPageIdPathSegment('personal-data'), false);
    assert.equal(isCmsPageIdPathSegment('about'), false);
    assert.equal(isCmsPageIdPathSegment('cms-page'), false);
  });
});
