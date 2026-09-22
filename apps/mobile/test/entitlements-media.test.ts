import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isActiveSubscription,
  isElevatedViewerRole,
  isPremiumUser,
} from '../src/entitlements/premium';
import { formatDuration, showsPremiumHint } from '../src/media/formatDuration';
import { catalogThumbnailUrl, sizeUrl } from '../src/media/thumbnail';

describe('isPremiumUser', () => {
  it('grants staff / non-viewer roles', () => {
    assert.equal(isPremiumUser({ role: 'admin', subscription: null }), true);
    assert.equal(isPremiumUser({ role: 'editor', subscription: null }), true);
    assert.equal(isPremiumUser({ role: 'viewer', subscription: null }), false);
  });

  it('requires active or trialing subscription for viewers', () => {
    assert.equal(
      isPremiumUser({
        role: 'viewer',
        subscription: { status: 'active', currentPeriodEnd: null },
      }),
      true,
    );
    assert.equal(
      isPremiumUser({
        role: 'viewer',
        subscription: { status: 'trialing', currentPeriodEnd: null },
      }),
      true,
    );
    assert.equal(
      isPremiumUser({
        role: 'viewer',
        subscription: { status: 'canceled', currentPeriodEnd: null },
      }),
      false,
    );
  });

  it('rejects expired currentPeriodEnd', () => {
    const now = new Date('2026-09-21T12:00:00Z');
    assert.equal(
      isActiveSubscription({ status: 'active', currentPeriodEnd: '2026-09-20T12:00:00Z' }, now),
      false,
    );
    assert.equal(
      isActiveSubscription({ status: 'active', currentPeriodEnd: '2026-09-22T12:00:00Z' }, now),
      true,
    );
  });

  it('normalizes elevated roles', () => {
    assert.equal(isElevatedViewerRole('  Admin '), true);
    assert.equal(isElevatedViewerRole('viewer'), false);
  });
});

describe('thumbnail sizeUrl', () => {
  it('swaps size tokens and preserves query', () => {
    const base = 'https://cdn.example/thumbnails/v1/large.jpg';
    assert.equal(sizeUrl(base, 'small'), 'https://cdn.example/thumbnails/v1/small.jpg');
    assert.equal(
      sizeUrl(`${base}?t=9`, 'medium'),
      'https://cdn.example/thumbnails/v1/medium.jpg?t=9',
    );
    assert.equal(catalogThumbnailUrl(base), 'https://cdn.example/thumbnails/v1/small.jpg');
    assert.equal(sizeUrl(null, 'small'), undefined);
  });
});

describe('formatDuration / premium hint', () => {
  it('formats durations', () => {
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(3661), '1:01:01');
    assert.equal(formatDuration(0), '--');
  });

  it('detects premium preview hints (null vs explicit zero)', () => {
    assert.equal(showsPremiumHint(600, null), false);
    assert.equal(showsPremiumHint(600, undefined), false);
    assert.equal(showsPremiumHint(600, 0), true);
    assert.equal(showsPremiumHint(600, 30), true);
    assert.equal(showsPremiumHint(600, 600), false);
    assert.equal(showsPremiumHint(0, 30), true);
    assert.equal(showsPremiumHint(0, 0), false);
  });
});
