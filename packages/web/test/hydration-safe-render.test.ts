import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strings as csStrings } from '../locales/cs/strings';
import { strings as enStrings } from '../locales/en/strings';
import { strings as skStrings } from '../locales/sk/strings';
import { errorPageCopy } from '../utils/errorPageCopy';
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

// Unrouted URLs such as /rss and /sitemap.xml reach the 404 thrown by pages/[slug].vue
// and render error.vue. The server renders it, the client hydrates it from the payload,
// so the copy must come only from values both sides share: the status code and catalog.
describe('error page copy', () => {
  it('uses the not-found copy for 404', () => {
    assert.deepEqual(errorPageCopy(404, enStrings), {
      statusCode: 404,
      title: enStrings.errorPageNotFoundTitle,
      description: enStrings.errorPageNotFoundDescription,
    });
  });

  it('reads the status code the payload serializes as a string the same way', () => {
    assert.deepEqual(errorPageCopy('404', enStrings), errorPageCopy(404, enStrings));
    assert.deepEqual(errorPageCopy('503', enStrings), errorPageCopy(503, enStrings));
  });

  it('uses the generic copy for other errors', () => {
    assert.deepEqual(errorPageCopy(503, enStrings), {
      statusCode: 503,
      title: enStrings.errorPageGenericTitle,
      description: enStrings.errorPageGenericDescription,
    });
  });

  it('falls back to 500 for missing or invalid status codes', () => {
    assert.equal(errorPageCopy(undefined, enStrings).statusCode, 500);
    assert.equal(errorPageCopy('not a status', enStrings).statusCode, 500);
    assert.equal(errorPageCopy(200, enStrings).statusCode, 500);
  });

  it('has copy in every locale', () => {
    for (const catalog of [enStrings, skStrings, csStrings]) {
      for (const code of [404, 500]) {
        const copy = errorPageCopy(code, catalog);
        assert.ok(copy.title.trim());
        assert.ok(copy.description.trim());
      }
    }
  });
});
