import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveRssFreePreviewEnabledFromPatch } from '../src/adminSystemFeatures.js';

describe('resolveRssFreePreviewEnabledFromPatch', () => {
  it('returns null when neither RSS field is present', () => {
    assert.equal(resolveRssFreePreviewEnabledFromPatch({}), null);
  });

  it('uses canonical rssPodcastEnabled when provided, including false', () => {
    assert.equal(
      resolveRssFreePreviewEnabledFromPatch({
        rssPodcastEnabled: false,
        freePodcastPreviewEnabled: true,
      }),
      false,
    );
    assert.equal(
      resolveRssFreePreviewEnabledFromPatch({ rssPodcastEnabled: true }),
      true,
    );
  });

  it('falls back to deprecated freePodcastPreviewEnabled when canonical field is absent', () => {
    assert.equal(
      resolveRssFreePreviewEnabledFromPatch({ freePodcastPreviewEnabled: true }),
      true,
    );
    assert.equal(
      resolveRssFreePreviewEnabledFromPatch({ freePodcastPreviewEnabled: false }),
      false,
    );
  });
});
