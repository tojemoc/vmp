import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CMS_FOOTER_PAGE_ID,
  CMS_PERSONAL_DATA_PAGE_ID,
  CMS_SYSTEM_CMS_PAGE_IDS,
  isCmsPageIdPathSegment,
  isCmsSystemPageId,
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

describe('cms-page-* registry guard', () => {
  it('registers every known cms-page-* system id for delete/slug locks', () => {
    assert.ok(CMS_SYSTEM_CMS_PAGE_IDS.length > 0);
    for (const id of CMS_SYSTEM_CMS_PAGE_IDS) {
      assert.match(id, /^cms-page-[a-z0-9-]+$/i);
      assert.equal(isCmsPageIdPathSegment(id), true, `${id} must be routable`);
      assert.equal(isCmsSystemPageId(id), true, `${id} must be in the system registry`);
    }
    assert.equal(isCmsSystemPageId(CMS_PERSONAL_DATA_PAGE_ID), true);
  });

  it('documents that routing is wider than the registry', () => {
    // Future system pages route immediately, but delete/slug locks need an explicit registry entry.
    assert.equal(isCmsPageIdPathSegment('cms-page-terms'), true);
    assert.equal(isCmsSystemPageId('cms-page-terms'), false);
  });
});
