import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generatePairingCode,
  normalizeNativePushPlatform,
  normalizePairingCode,
} from '../src/nativeClients.js';

describe('generatePairingCode', () => {
  it('returns an 8-character alphanumeric code without ambiguous glyphs', () => {
    const code = generatePairingCode();
    assert.equal(code.length, 8);
    assert.match(code, /^[A-HJ-NP-Z2-9]+$/);
  });

  it('respects custom length', () => {
    assert.equal(generatePairingCode(6).length, 6);
  });
});

describe('normalizePairingCode', () => {
  it('uppercases and strips separators', () => {
    assert.equal(normalizePairingCode('ab-cd-ef-gh'), 'ABCDEFGH');
    assert.equal(normalizePairingCode('  xyz12345 '), 'XYZ12345');
  });

  it('rejects too-short or non-string values', () => {
    assert.equal(normalizePairingCode('abc'), null);
    assert.equal(normalizePairingCode(null), null);
    assert.equal(normalizePairingCode(12), null);
  });
});

describe('normalizeNativePushPlatform', () => {
  it('accepts ios and android only', () => {
    assert.equal(normalizeNativePushPlatform('ios'), 'ios');
    assert.equal(normalizeNativePushPlatform('android'), 'android');
    assert.equal(normalizeNativePushPlatform('web'), null);
    assert.equal(normalizeNativePushPlatform(''), null);
  });
});
