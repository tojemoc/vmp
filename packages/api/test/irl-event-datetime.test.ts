import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateEventDatetimes } from '../src/irlEvents.js';

describe('validateEventDatetimes', () => {
  it('rejects missing or unparseable startsAt', () => {
    assert.equal(validateEventDatetimes(null, null).ok, false);
    assert.equal(validateEventDatetimes('not-a-date', null).ok, false);
  });

  it('accepts parseable startsAt without endsAt', () => {
    const result = validateEventDatetimes('2026-10-01T18:00:00Z', null);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.endsAt, null);
  });

  it('rejects endsAt earlier than startsAt or unparseable', () => {
    assert.equal(validateEventDatetimes('2026-10-01T18:00:00Z', '2026-10-01T17:00:00Z').ok, false);
    assert.equal(validateEventDatetimes('2026-10-01T18:00:00Z', 'nope').ok, false);
  });

  it('accepts endsAt on or after startsAt', () => {
    const result = validateEventDatetimes('2026-10-01T18:00:00Z', '2026-10-01T20:00:00Z');
    assert.equal(result.ok, true);
  });
});
