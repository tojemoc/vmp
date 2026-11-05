import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { errorPageTitleKey, publicRssFeedUrl } from '../utils/unroutedPaths';

// /rss used to fall into pages/[slug].vue and render Nuxt's default error page,
// which logged "Hydration completed but contains mismatches." in the browser.
describe('publicRssFeedUrl', () => {
  it('points at the API public feed', () => {
    assert.equal(
      publicRssFeedUrl('https://vmp-api.tjm.sk'),
      'https://vmp-api.tjm.sk/api/feed/public',
    );
  });

  it('tolerates trailing slashes and whitespace', () => {
    assert.equal(
      publicRssFeedUrl(' https://vmp-api.tjm.sk// '),
      'https://vmp-api.tjm.sk/api/feed/public',
    );
  });

  it('refuses to redirect without an absolute http(s) API origin', () => {
    assert.equal(publicRssFeedUrl(''), null);
    assert.equal(publicRssFeedUrl(undefined), null);
    assert.equal(publicRssFeedUrl('/api'), null);
    assert.equal(publicRssFeedUrl('javascript:alert(1)'), null);
  });
});

describe('errorPageTitleKey', () => {
  it('treats client errors as not found', () => {
    assert.equal(errorPageTitleKey(404), 'errorPageNotFound');
    assert.equal(errorPageTitleKey(410), 'errorPageNotFound');
  });

  it('treats server errors and missing codes as unavailable', () => {
    assert.equal(errorPageTitleKey(503), 'errorPageUnavailable');
    assert.equal(errorPageTitleKey(500), 'errorPageUnavailable');
    assert.equal(errorPageTitleKey(undefined), 'errorPageUnavailable');
  });
});
