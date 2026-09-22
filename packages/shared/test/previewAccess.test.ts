import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { showsPremiumPreviewHint } from '../src/previewAccess.js';

describe('showsPremiumPreviewHint', () => {
  it('does not treat missing preview as premium-only', () => {
    assert.equal(showsPremiumPreviewHint(600, null), false);
    assert.equal(showsPremiumPreviewHint(600, undefined), false);
    assert.equal(showsPremiumPreviewHint(600, Number.NaN), false);
  });

  it('treats explicit zero preview as premium-only when full is known', () => {
    assert.equal(showsPremiumPreviewHint(600, 0), true);
  });

  it('does not badge explicit zero when full duration is unknown', () => {
    assert.equal(showsPremiumPreviewHint(0, 0), false);
    assert.equal(showsPremiumPreviewHint(null, 0), false);
  });

  it('badges positive previews shorter than full or when full is unknown', () => {
    assert.equal(showsPremiumPreviewHint(600, 30), true);
    assert.equal(showsPremiumPreviewHint(600, 600), false);
    assert.equal(showsPremiumPreviewHint(0, 30), true);
  });
});
