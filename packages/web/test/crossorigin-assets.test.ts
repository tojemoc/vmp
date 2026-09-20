import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addCrossOriginToAssetTags } from '../utils/crossOriginAssets';

describe('addCrossOriginToAssetTags', () => {
  it('marks same-origin module scripts cross-origin', () => {
    assert.equal(
      addCrossOriginToAssetTags('<script type="module" src="/_nuxt/entry.js"></script>'),
      '<script type="module" src="/_nuxt/entry.js" crossorigin="anonymous"></script>',
    );
  });

  it('marks same-origin module preload links cross-origin', () => {
    assert.equal(
      addCrossOriginToAssetTags('<link rel="modulepreload" href="/_nuxt/chunk.js">'),
      '<link rel="modulepreload" href="/_nuxt/chunk.js" crossorigin="anonymous">',
    );
  });

  it('leaves third-party scripts untouched', () => {
    const gtm = '<script src="https://www.googletagmanager.com/gtm.js"></script>';
    assert.equal(addCrossOriginToAssetTags(gtm), gtm);
  });

  it('leaves protocol-relative scripts untouched', () => {
    const tag = '<script src="//cdn.example.com/x.js"></script>';
    assert.equal(addCrossOriginToAssetTags(tag), tag);
  });

  it('does not double-add when crossorigin is already present', () => {
    const tag = '<script src="/_nuxt/entry.js" crossorigin></script>';
    assert.equal(addCrossOriginToAssetTags(tag), tag);
  });

  it('leaves inline scripts and non-script links untouched', () => {
    const inline = '<script>window.__x=1</script>';
    assert.equal(addCrossOriginToAssetTags(inline), inline);
    const stylesheet = '<link rel="stylesheet" href="/_nuxt/app.css">';
    assert.equal(addCrossOriginToAssetTags(stylesheet), stylesheet);
  });
});
