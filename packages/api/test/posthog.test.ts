import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  captureMappedPostHogEvent,
  capturePostHogEvent,
  capturePostHogException,
  createPostHogClient,
  DEFAULT_POSTHOG_HOST,
  POSTHOG_TRACING_REQUEST_HEADERS,
  posthogContextFromRequest,
  posthogEventFromLegacyWebhook,
  posthogEventFromStripeWebhook,
  redactPathForAnalytics,
  resetPostHogClientForTests,
  resolvePostHogHost,
  resolvePostHogProjectToken,
  setPostHogCaptureForTests,
  setPostHogExceptionForTests,
} from '../src/posthog.js';

describe('PostHog API helper', () => {
  afterEach(() => {
    setPostHogCaptureForTests(null);
    setPostHogExceptionForTests(null);
    resetPostHogClientForTests();
  });

  it('resolves project token and host from Worker env', () => {
    assert.equal(resolvePostHogProjectToken({}), '');
    assert.equal(resolvePostHogProjectToken({ POSTHOG_PROJECT_TOKEN: ' phc_abc ' }), 'phc_abc');
    assert.equal(resolvePostHogProjectToken({ POSTHOG_KEY: 'phc_alt' }), 'phc_alt');
    assert.equal(resolvePostHogHost({}), DEFAULT_POSTHOG_HOST);
    assert.equal(
      resolvePostHogHost({ POSTHOG_HOST: ' https://us.i.posthog.com ' }),
      'https://us.i.posthog.com',
    );
  });

  it('does not construct a client without a project token', () => {
    assert.equal(createPostHogClient({}), null);
    assert.equal(createPostHogClient({ POSTHOG_HOST: 'https://eu.i.posthog.com' }), null);
  });

  it('exports tracing headers required for CORS preflight', () => {
    assert.deepEqual(
      [...POSTHOG_TRACING_REQUEST_HEADERS],
      ['X-POSTHOG-DISTINCT-ID', 'X-POSTHOG-SESSION-ID'],
    );
  });

  it('reads tracing headers from incoming requests', () => {
    const request = new Request('https://vmp-api.tjm.sk/api/auth/me', {
      headers: {
        'X-POSTHOG-DISTINCT-ID': 'user_1',
        'X-POSTHOG-SESSION-ID': 'sess_1',
      },
    });
    assert.deepEqual(posthogContextFromRequest(request), {
      distinctId: 'user_1',
      sessionId: 'sess_1',
    });
  });

  it('redacts path identifiers for analytics properties', () => {
    assert.equal(
      redactPathForAnalytics(
        '/api/feed/550e8400-e29b-41d4-a716-446655440000/abcdef0123456789abcdef01',
      ),
      '/api/feed/:id/:token',
    );
    assert.equal(
      redactPathForAnalytics('/api/account/playback-positions/video_123'),
      '/api/account/playback-positions/video_123',
    );
  });

  it('maps Stripe webhook types to product events without duplicating checkout create invoices', () => {
    assert.deepEqual(
      posthogEventFromStripeWebhook(
        'checkout.session.completed',
        { metadata: { planType: 'yearly' } },
        'user_1',
      ),
      {
        distinctId: 'user_1',
        event: 'subscription_activated',
        properties: {
          source: 'stripe_webhook',
          stripe_event: 'checkout.session.completed',
          provider: 'stripe',
          plan_type: 'yearly',
        },
      },
    );
    assert.equal(
      posthogEventFromStripeWebhook(
        'invoice.paid',
        { billing_reason: 'subscription_create' },
        'user_1',
      ),
      null,
    );
    assert.equal(
      posthogEventFromStripeWebhook(
        'invoice.paid',
        { billing_reason: 'subscription_cycle' },
        'user_1',
      )?.event,
      'subscription_renewed',
    );
    assert.equal(
      posthogEventFromStripeWebhook('customer.subscription.deleted', {}, 'user_1')?.event,
      'subscription_cancelled',
    );
    assert.equal(
      posthogEventFromStripeWebhook('invoice.payment_failed', {}, 'user_1')?.event,
      'subscription_payment_failed',
    );
    assert.equal(
      posthogEventFromStripeWebhook('customer.subscription.updated', {}, 'user_1'),
      null,
    );
  });

  it('maps legacy webhook terminal statuses', () => {
    assert.equal(
      posthogEventFromLegacyWebhook('cancelled', 'user_2')?.event,
      'subscription_cancelled',
    );
    assert.equal(
      posthogEventFromLegacyWebhook('past_due', 'user_2')?.event,
      'subscription_payment_failed',
    );
    assert.equal(posthogEventFromLegacyWebhook('active', 'user_2'), null);
  });

  it('capturePostHogEvent is a no-op without a token or distinct id', async () => {
    const captured: unknown[] = [];
    setPostHogCaptureForTests((input) => {
      captured.push(input);
    });
    await capturePostHogEvent({}, { distinctId: 'user_1', event: 'subscription_activated' });
    await capturePostHogEvent(
      { POSTHOG_PROJECT_TOKEN: 'phc_test' },
      { distinctId: '  ', event: 'subscription_activated' },
    );
    assert.deepEqual(captured, []);
  });

  it('forwards captures through the test handler including session id', async () => {
    const captured: Array<{ event: string; properties?: Record<string, unknown> }> = [];
    setPostHogCaptureForTests((input) => {
      captured.push({ event: input.event, properties: input.properties });
    });
    const request = new Request('https://example.test/api/x', {
      headers: { 'X-POSTHOG-SESSION-ID': 'sess_abc' },
    });
    await capturePostHogEvent(
      { POSTHOG_PROJECT_TOKEN: 'phc_test' },
      { distinctId: 'user_1', event: 'subscription_activated', properties: { provider: 'stripe' } },
      { request },
    );
    assert.deepEqual(captured, [
      {
        event: 'subscription_activated',
        properties: { $session_id: 'sess_abc', provider: 'stripe' },
      },
    ]);
  });

  it('schedules mapped captures via waitUntil when ctx is provided', async () => {
    const captured: string[] = [];
    const scheduled: Promise<unknown>[] = [];
    setPostHogCaptureForTests(async (input) => {
      await Promise.resolve();
      captured.push(input.event);
    });
    const result = captureMappedPostHogEvent(
      { POSTHOG_PROJECT_TOKEN: 'phc_test' },
      { distinctId: 'user_1', event: 'subscription_activated' },
      {
        waitUntil(promise) {
          scheduled.push(promise);
        },
      },
    );
    assert.equal(result, undefined);
    assert.equal(scheduled.length, 1);
    await scheduled[0];
    assert.deepEqual(captured, ['subscription_activated']);
  });

  it('forwards exceptions through the test handler', async () => {
    const seen: Array<{ distinctId: string }> = [];
    setPostHogExceptionForTests((_error, distinctId) => {
      seen.push({ distinctId });
    });
    await capturePostHogException({ POSTHOG_PROJECT_TOKEN: 'phc_test' }, new Error('boom'), {
      distinctId: 'user_9',
    });
    assert.deepEqual(seen, [{ distinctId: 'user_9' }]);
  });

  it('attributes unauthenticated exceptions to a request-scoped distinct id', async () => {
    const seen: Array<{ distinctId: string; properties?: Record<string, unknown> }> = [];
    setPostHogExceptionForTests((_error, distinctId, properties) => {
      seen.push({ distinctId, properties });
    });
    await capturePostHogException({ POSTHOG_PROJECT_TOKEN: 'phc_test' }, new Error('boom'));
    assert.equal(seen.length, 1);
    assert.match(seen[0].distinctId, /^server_error:[0-9a-f-]{36}$/i);
    assert.equal(seen[0].properties?.anonymous_exception, true);
  });
});
