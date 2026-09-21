import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTotpSessionExpired, normalizeTotpCode, TotpVerifyError } from '../src/auth/totp';

describe('mobile TOTP helpers', () => {
  it('normalizeTotpCode accepts digit-only and strips separators', () => {
    assert.equal(normalizeTotpCode('123456'), '123456');
    assert.equal(normalizeTotpCode('123 456'), '123456');
    assert.equal(normalizeTotpCode('12-34-56'), '123456');
    assert.equal(normalizeTotpCode('12345'), null);
    assert.equal(normalizeTotpCode('1234567'), null);
    assert.equal(normalizeTotpCode('abcdef'), null);
  });

  it('isTotpSessionExpired detects API session_expired code', () => {
    assert.equal(isTotpSessionExpired(new TotpVerifyError('gone', 401, 'session_expired')), true);
  });

  it('isTotpSessionExpired detects expired / used wording', () => {
    assert.equal(
      isTotpSessionExpired(
        new TotpVerifyError('Sign-in session expired. Please start again.', 401),
      ),
      true,
    );
    assert.equal(
      isTotpSessionExpired(
        new TotpVerifyError('Too many incorrect attempts. Please sign in again.', 401),
      ),
      true,
    );
    assert.equal(
      isTotpSessionExpired(new TotpVerifyError('This sign-in link has already been used.', 401)),
      true,
    );
  });

  it('isTotpSessionExpired ignores wrong-code errors', () => {
    assert.equal(
      isTotpSessionExpired(new TotpVerifyError('Invalid code. Please try again.', 400)),
      false,
    );
    assert.equal(isTotpSessionExpired(new Error('Invalid code')), false);
    assert.equal(isTotpSessionExpired(null), false);
  });
});
