import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMetricHttpRoute, UNMATCHED_METRIC_HTTP_ROUTE } from '../src/metricHttpRoutes.js';

describe('resolveMetricHttpRoute', () => {
  it('returns exact static templates', () => {
    assert.equal(resolveMetricHttpRoute('/api/health'), '/api/health');
    assert.equal(resolveMetricHttpRoute('/api/videos'), '/api/videos');
    assert.equal(resolveMetricHttpRoute('/api/auth/magic-link'), '/api/auth/magic-link');
  });

  it('maps dynamic segments to templates', () => {
    assert.equal(resolveMetricHttpRoute('/api/videos/abc-123/meta'), '/api/videos/:id/meta');
    assert.equal(
      resolveMetricHttpRoute('/api/video-access/user_1/vid_2'),
      '/api/video-access/:userId/:videoId',
    );
    assert.equal(
      resolveMetricHttpRoute('/api/video-proxy/videos/x/master.m3u8'),
      '/api/video-proxy/:path',
    );
    assert.equal(resolveMetricHttpRoute('/api/feed/user1/secrettoken'), '/api/feed/:userId/:token');
    assert.equal(
      resolveMetricHttpRoute('/api/pages/cms-page-personal-data/publish'),
      '/api/pages/:id/publish',
    );
  });

  it('collapses unknown paths to a single unmatched label', () => {
    assert.equal(resolveMetricHttpRoute('/api/evil/foo/bar'), UNMATCHED_METRIC_HTTP_ROUTE);
    assert.equal(resolveMetricHttpRoute('/not-an-api'), UNMATCHED_METRIC_HTTP_ROUTE);
    assert.equal(resolveMetricHttpRoute('/api/videos/extra/segments'), UNMATCHED_METRIC_HTTP_ROUTE);
  });
});
