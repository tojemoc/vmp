import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initialHydratedState } from '../utils/hydrationGate';
import { formatRelativeUploadTime, parseApiTimestamp } from '../utils/relativeUploadTime';

// SSR (and the prerendered "/") always render signed out, while plugins/auth.client.ts
// restores the session before hydration. Auth-dependent markup must keep the server
// shape until the component has mounted, or Vue reports a hydration mismatch.
describe('hydration gate', () => {
  it('stays closed on the server', () => {
    assert.equal(initialHydratedState({ isClient: false, isHydrating: false }), false);
  });

  it('stays closed while the client hydrates server HTML', () => {
    assert.equal(initialHydratedState({ isClient: true, isHydrating: true }), false);
  });

  it('opens immediately for client-side navigations', () => {
    assert.equal(initialHydratedState({ isClient: true, isHydrating: false }), true);
  });
});

// VideoCard renders "Xmo ago" on the prerendered homepage. Server and client must agree
// on the upload instant (D1 timestamps carry no zone) and on the reference clock.
describe('relative upload time', () => {
  it('reads zone-less API timestamps as UTC', () => {
    assert.equal(parseApiTimestamp('2026-05-08 16:56:41'), Date.parse('2026-05-08T16:56:41Z'));
    assert.equal(parseApiTimestamp('2026-05-08T16:56:41'), Date.parse('2026-05-08T16:56:41Z'));
  });

  it('keeps explicit zones', () => {
    assert.equal(
      parseApiTimestamp('2026-05-08T16:56:41+02:00'),
      Date.parse('2026-05-08T14:56:41Z'),
    );
    assert.equal(parseApiTimestamp('2026-05-08T16:56:41.000Z'), Date.parse('2026-05-08T16:56:41Z'));
  });

  it('is deterministic for the same reference clock', () => {
    const buildTime = Date.parse('2026-10-02T17:38:13Z');
    assert.equal(formatRelativeUploadTime('2026-05-08 16:56:41', buildTime), '4mo ago');
    assert.equal(
      formatRelativeUploadTime('2026-05-08 16:56:41', buildTime),
      formatRelativeUploadTime('2026-05-08T16:56:41Z', buildTime),
    );
  });

  it('formats each bucket', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    assert.equal(formatRelativeUploadTime('2026-10-02 11:59:30', now), 'just now');
    assert.equal(formatRelativeUploadTime('2026-10-02 11:15:00', now), '45m ago');
    assert.equal(formatRelativeUploadTime('2026-10-02 07:00:00', now), '5h ago');
    assert.equal(formatRelativeUploadTime('2026-09-25 12:00:00', now), '7d ago');
    assert.equal(formatRelativeUploadTime('2025-09-01 12:00:00', now), '1y ago');
  });

  it('returns empty for missing, invalid, or future dates', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    assert.equal(formatRelativeUploadTime('', now), '');
    assert.equal(formatRelativeUploadTime(null, now), '');
    assert.equal(formatRelativeUploadTime('not a date', now), '');
    assert.equal(formatRelativeUploadTime('2026-10-03 12:00:00', now), '');
  });
});
