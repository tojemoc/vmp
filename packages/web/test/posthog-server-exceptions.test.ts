import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  httpStatusFromError,
  newServerExceptionDistinctId,
  serverExceptionProperties,
  shouldCaptureServerException,
} from '../utils/posthogServerExceptions';

/** Shape Nitro hands the `error` hook for an unmatched route. */
function h3Error(statusCode: number, statusMessage: string): Error {
  return Object.assign(new Error(statusMessage), { statusCode, statusMessage });
}

describe('PostHog server exception filter', () => {
  it('drops the 404s bots generate by probing for secrets', () => {
    assert.equal(shouldCaptureServerException(h3Error(404, 'Page not found: /.env')), false);
    assert.equal(shouldCaptureServerException(h3Error(404, 'Page not found: /.git/config')), false);
    // The H3 error object arrives without an Error prototype in some Nitro paths.
    assert.equal(
      shouldCaptureServerException({ statusCode: 404, statusMessage: 'Page not found' }),
      false,
    );
  });

  it('drops the deliberate createError(404) throws from pages/[slug].vue', () => {
    assert.equal(shouldCaptureServerException(h3Error(404, 'Page not found')), false);
  });

  it('drops the rest of the 4xx range, including string statuses', () => {
    for (const status of [400, 401, 403, 429, 499]) {
      assert.equal(shouldCaptureServerException(h3Error(status, 'nope')), false);
    }
    assert.equal(shouldCaptureServerException({ status: '404' }), false);
  });

  it('keeps server faults and unclassified throws', () => {
    assert.equal(shouldCaptureServerException(h3Error(500, 'Internal Server Error')), true);
    assert.equal(shouldCaptureServerException(h3Error(502, 'Bad Gateway')), true);
    assert.equal(shouldCaptureServerException(new TypeError('this.api is undefined')), true);
    assert.equal(shouldCaptureServerException('boom'), true);
    assert.equal(shouldCaptureServerException(undefined), true);
    assert.equal(shouldCaptureServerException({ statusCode: 'not-a-status' }), true);
  });

  it('reads the status off H3 and $fetch errors', () => {
    assert.equal(httpStatusFromError(h3Error(503, 'Service Unavailable')), 503);
    assert.equal(httpStatusFromError({ status: 500 }), 500);
    assert.equal(httpStatusFromError(new Error('no status')), undefined);
  });
});

describe('PostHog server exception properties', () => {
  it('keeps the route but strips query params that may carry tokens', () => {
    const properties = serverExceptionProperties({
      path: '/auth/verify?token=secret#frag',
      method: 'GET',
      status: 500,
      environment: 'production',
    });
    assert.equal(properties.path, '/auth/verify');
    assert.equal(properties.method, 'GET');
    assert.equal(properties.status_code, 500);
    assert.equal(properties.$environment, 'production');
  });

  it('never creates a person profile for a server throw', () => {
    const properties = serverExceptionProperties({});
    assert.equal(properties.$process_person_profile, false);
    assert.ok(!('path' in properties));
    assert.ok(!('status_code' in properties));
    assert.ok(!('$environment' in properties));
  });

  it('gives every fault its own distinct id so occurrences are not one "user"', () => {
    const first = newServerExceptionDistinctId();
    assert.match(first, /^web_server_error:/);
    assert.notEqual(first, newServerExceptionDistinctId());
  });
});
