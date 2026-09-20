import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMagicLinkClient } from '@vmp/shared';

describe('normalizeMagicLinkClient', () => {
  it('accepts browser | pwa | native (case-insensitive)', () => {
    assert.equal(normalizeMagicLinkClient('browser'), 'browser');
    assert.equal(normalizeMagicLinkClient('PWA'), 'pwa');
    assert.equal(normalizeMagicLinkClient('Native'), 'native');
  });

  it('defaults unknown / missing values to browser', () => {
    assert.equal(normalizeMagicLinkClient(undefined), 'browser');
    assert.equal(normalizeMagicLinkClient(''), 'browser');
    assert.equal(normalizeMagicLinkClient('desktop'), 'browser');
    assert.equal(normalizeMagicLinkClient(null), 'browser');
  });

  it('unwraps array query values', () => {
    assert.equal(normalizeMagicLinkClient(['native', 'browser']), 'native');
  });
});
