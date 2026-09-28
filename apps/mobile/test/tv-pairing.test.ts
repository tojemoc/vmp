import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideTvPairingPoll,
  normalizePairingCode,
  pairingBudgetExhausted,
  pairingMaxAttempts,
} from '../src/auth/tvPairing';

describe('tvPairing helpers', () => {
  it('normalizePairingCode matches API gates (6–12 alphanumerics)', () => {
    assert.equal(normalizePairingCode('abcd2345'), 'ABCD2345');
    assert.equal(normalizePairingCode('  ab-cd_2345  '), 'ABCD2345');
    assert.equal(normalizePairingCode('abc'), null);
    assert.equal(normalizePairingCode('ABCDEFGHIJKLM'), null);
  });

  it('pairingMaxAttempts covers the TTL window with a near-expiry attempt', () => {
    const started = Date.parse('2026-01-01T00:00:00.000Z');
    const expires = '2026-01-01T00:05:00.000Z';
    // floor(300/60)+1 = 6 so a poll can still run near expiry
    assert.equal(pairingMaxAttempts(expires, started, 60), 6);
    assert.equal(pairingMaxAttempts(expires, started, 0), 1);
    assert.equal(pairingMaxAttempts('not-a-date', started, 60), 1);
  });

  it('pairingBudgetExhausted uses expiresAt when valid; maxAttempts only as invalid-expiry fallback', () => {
    const started = Date.parse('2026-01-01T00:00:00.000Z');
    const expires = '2026-01-01T00:05:00.000Z';
    assert.equal(
      pairingBudgetExhausted({
        expiresAt: expires,
        startedAtMs: started,
        attempt: 1,
        maxAttempts: 5,
        nowMs: started + 60_000,
      }),
      false,
    );
    // Valid expiresAt: attempt count alone must not terminate.
    assert.equal(
      pairingBudgetExhausted({
        expiresAt: expires,
        startedAtMs: started,
        attempt: 99,
        maxAttempts: 5,
        nowMs: started + 60_000,
      }),
      false,
    );
    assert.equal(
      pairingBudgetExhausted({
        expiresAt: expires,
        startedAtMs: started,
        attempt: 1,
        maxAttempts: 5,
        nowMs: Date.parse(expires),
      }),
      true,
    );
    // Invalid expiry falls back to maxAttempts.
    assert.equal(
      pairingBudgetExhausted({
        expiresAt: 'not-a-date',
        startedAtMs: started,
        attempt: 5,
        maxAttempts: 5,
        nowMs: started,
      }),
      true,
    );
    assert.equal(
      pairingBudgetExhausted({
        expiresAt: 'not-a-date',
        startedAtMs: started,
        attempt: 4,
        maxAttempts: 5,
        nowMs: started,
      }),
      false,
    );
  });

  it('decideTvPairingPoll never distinguishes unknown from pending', () => {
    assert.deepEqual(
      decideTvPairingPoll({
        status: 'pending',
        pollIntervalSeconds: 2,
        budgetExhausted: false,
      }),
      { action: 'continue', delayMs: 2000 },
    );
    assert.deepEqual(
      decideTvPairingPoll({
        status: undefined,
        pollIntervalSeconds: 2,
        budgetExhausted: false,
      }),
      { action: 'continue', delayMs: 2000 },
    );
    assert.deepEqual(
      decideTvPairingPoll({ status: 'ready', pollIntervalSeconds: 2, budgetExhausted: false }),
      { action: 'ready' },
    );
    assert.deepEqual(
      decideTvPairingPoll({ status: 'expired', pollIntervalSeconds: 2, budgetExhausted: false }),
      { action: 'terminal', reason: 'expired' },
    );
    assert.deepEqual(
      decideTvPairingPoll({
        httpStatus: 409,
        code: 'already_used',
        pollIntervalSeconds: 2,
        budgetExhausted: false,
      }),
      { action: 'terminal', reason: 'already_used' },
    );
    assert.deepEqual(
      decideTvPairingPoll({
        httpStatus: 429,
        code: 'rate_limited',
        pollIntervalSeconds: 2,
        budgetExhausted: false,
      }),
      { action: 'backoff', delayMs: 4000 },
    );
    assert.deepEqual(
      decideTvPairingPoll({
        status: 'pending',
        pollIntervalSeconds: 2,
        budgetExhausted: true,
      }),
      { action: 'terminal', reason: 'timeout' },
    );
  });

  it('decideTvPairingPoll clamps continue delay to remaining TTL', () => {
    const expires = '2026-01-01T00:05:00.000Z';
    const nowMs = Date.parse(expires) - 1500;
    assert.deepEqual(
      decideTvPairingPoll({
        status: 'pending',
        pollIntervalSeconds: 5,
        budgetExhausted: false,
        expiresAt: expires,
        nowMs,
      }),
      { action: 'continue', delayMs: 1500 },
    );
    assert.deepEqual(
      decideTvPairingPoll({
        status: 'pending',
        pollIntervalSeconds: 5,
        budgetExhausted: false,
        expiresAt: expires,
        nowMs: Date.parse(expires),
      }),
      { action: 'terminal', reason: 'timeout' },
    );
  });
});
