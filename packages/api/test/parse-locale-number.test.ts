import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getLegacyCheckoutApiBase,
  isLegacyCheckoutConfigured,
} from '../src/legacyProvider.js';
import { parseLocaleNumber } from '../src/parseLocaleNumber.js';

describe('parseLocaleNumber', () => {
  it('parses plain integers and dotted decimals', () => {
    assert.equal(parseLocaleNumber('9'), 9);
    assert.equal(parseLocaleNumber('9.99'), 9.99);
    assert.equal(parseLocaleNumber(12.5), 12.5);
  });

  it('accepts comma as decimal separator', () => {
    assert.equal(parseLocaleNumber('9,99'), 9.99);
    assert.equal(parseLocaleNumber('0,5'), 0.5);
  });

  it('handles European and US thousands groupings', () => {
    assert.equal(parseLocaleNumber('1.234,56'), 1234.56);
    assert.equal(parseLocaleNumber('1,234.56'), 1234.56);
  });

  it('trims whitespace and ignores a leading plus', () => {
    assert.equal(parseLocaleNumber('  9,50 '), 9.5);
    assert.equal(parseLocaleNumber('+3.25'), 3.25);
  });

  it('returns null for empty or invalid values', () => {
    assert.equal(parseLocaleNumber(''), null);
    assert.equal(parseLocaleNumber(null), null);
    assert.equal(parseLocaleNumber(undefined), null);
    assert.equal(parseLocaleNumber('abc'), null);
    assert.equal(parseLocaleNumber(Number.NaN), null);
  });
});

describe('legacy checkout API base selection', () => {
  it('prefers production when fully configured', () => {
    const env = {
      LEGACY_ESHOP_API_URL: 'https://prod.example/api',
      LEGACY_ESHOP_SANDBOX_API_URL: 'https://sandbox.example/api',
      LEGACY_ESHOP_MERCHANT_ID: 'm1',
      LEGACY_ESHOP_API_KEY: 'k1',
    };
    assert.equal(isLegacyCheckoutConfigured(env), true);
    assert.equal(getLegacyCheckoutApiBase(env), 'https://prod.example/api');
  });

  it('falls back to sandbox when production URL is missing', () => {
    const env = {
      LEGACY_ESHOP_SANDBOX_API_URL: 'https://sandbox.example/api',
      LEGACY_ESHOP_MERCHANT_ID: 'm1',
      LEGACY_ESHOP_API_KEY: 'k1',
    };
    assert.equal(isLegacyCheckoutConfigured(env), true);
    assert.equal(getLegacyCheckoutApiBase(env), 'https://sandbox.example/api');
  });

  it('is not configured without merchant credentials', () => {
    const env = {
      LEGACY_ESHOP_SANDBOX_API_URL: 'https://sandbox.example/api',
    };
    assert.equal(isLegacyCheckoutConfigured(env), false);
  });
});
