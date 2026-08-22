import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POSTHOG_CAPTURE_PAGELEAVE, POSTHOG_CAPTURE_PAGEVIEW } from '../utils/posthogPageview';

describe('PostHog SPA pageview config', () => {
  it('uses history_change so Nuxt client navigations emit $pageview', () => {
    assert.equal(POSTHOG_CAPTURE_PAGEVIEW, 'history_change');
    assert.equal(POSTHOG_CAPTURE_PAGELEAVE, 'if_capture_pageview');
  });
});
