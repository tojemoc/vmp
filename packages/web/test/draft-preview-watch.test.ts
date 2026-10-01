import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeParamMatchesVideoMeta } from '../utils/watchRouteMeta';

describe('staff draft preview watch routing', () => {
  it('matches draft preview by UUID even when a slug exists', () => {
    const meta = { id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', slug: 'my-draft' };
    assert.equal(routeParamMatchesVideoMeta(meta.id, meta), true);
    assert.equal(routeParamMatchesVideoMeta('my-draft', meta), true);
    assert.equal(routeParamMatchesVideoMeta('other-id', meta), false);
  });

  it('matches UUID-only drafts with no slug', () => {
    const meta = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', slug: null };
    assert.equal(routeParamMatchesVideoMeta(meta.id, meta), true);
  });
});
