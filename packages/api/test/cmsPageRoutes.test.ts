import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CMS_PERSONAL_DATA_PAGE_ID, isCmsPageIdPathSegment } from '@vmp/shared';

/**
 * Mirrors packages/api/src/index.ts CMS page route matching.
 * Regression: PUT /api/pages/cms-page-personal-data must hit by-id, not fall through.
 */
function matchCmsPageRoute(pathname: string, method: string): 'by-id' | 'by-slug' | 'revisions' | null {
  const revisions = pathname.match(/^\/api\/pages\/([^/]+)\/revisions$/);
  if (revisions?.[1] && isCmsPageIdPathSegment(revisions[1]) && method === 'GET') return 'revisions';

  const byId = pathname.match(/^\/api\/pages\/([^/]+)$/);
  const segment = byId?.[1];
  if (segment && isCmsPageIdPathSegment(segment) && ['GET', 'PUT', 'DELETE'].includes(method)) {
    return 'by-id';
  }
  if (segment && method === 'GET') return 'by-slug';
  return null;
}

describe('CMS page route matching', () => {
  it('routes PUT for personal-data system id to by-id (not 404 fallthrough)', () => {
    assert.equal(
      matchCmsPageRoute(`/api/pages/${CMS_PERSONAL_DATA_PAGE_ID}`, 'PUT'),
      'by-id',
    );
    assert.equal(
      matchCmsPageRoute(`/api/pages/${CMS_PERSONAL_DATA_PAGE_ID}/revisions`, 'GET'),
      'revisions',
    );
  });

  it('still serves public slug GET via by-slug', () => {
    assert.equal(matchCmsPageRoute('/api/pages/personal-data', 'GET'), 'by-slug');
    assert.equal(matchCmsPageRoute('/api/pages/personal-data', 'PUT'), null);
  });
});
