import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { httpStatusFromError, isNotFoundError } from '../utils/httpErrorStatus';
import {
  redactErrorPath,
  serverErrorProperties,
  shouldReportServerError,
} from '../utils/serverErrorReporting';

describe('httpStatusFromError', () => {
  it('reads statusCode from a createError payload', () => {
    assert.equal(httpStatusFromError({ statusCode: 404, statusMessage: 'Page not found' }), 404);
  });

  it('reads response.status from a FetchError', () => {
    assert.equal(httpStatusFromError({ response: { status: 503 } }), 503);
  });

  it('reads a bare status', () => {
    assert.equal(httpStatusFromError({ status: 500 }), 500);
  });

  it('returns null for a transport failure with no status', () => {
    assert.equal(httpStatusFromError(new Error('fetch failed')), null);
    assert.equal(httpStatusFromError(new Error('The operation was aborted')), null);
  });

  it('returns null for non-object errors', () => {
    assert.equal(httpStatusFromError('boom'), null);
    assert.equal(httpStatusFromError(undefined), null);
  });

  it('ignores non-numeric status values', () => {
    assert.equal(httpStatusFromError({ statusCode: '404' }), null);
    assert.equal(httpStatusFromError({ statusCode: Number.NaN }), null);
  });

  it('only treats an explicit 404 as a missing resource', () => {
    assert.equal(isNotFoundError({ statusCode: 404 }), true);
    assert.equal(isNotFoundError({ statusCode: 500 }), false);
    // A CMS timeout must not be read as "this page does not exist".
    assert.equal(isNotFoundError(new Error('fetch failed')), false);
  });
});

describe('shouldReportServerError', () => {
  it('drops the 404 Nitro raises for an unmatched route', () => {
    // Shape of the scanner probes that flooded error tracking.
    const nitroNotFound = Object.assign(new Error('Page not found: /.git/config'), {
      statusCode: 404,
    });
    assert.equal(shouldReportServerError(nitroNotFound), false);
  });

  it('drops a bare object thrown by createError', () => {
    assert.equal(
      shouldReportServerError({ statusCode: 404, statusMessage: 'Page not found' }),
      false,
    );
  });

  it('drops other request-level 4xx', () => {
    for (const status of [400, 401, 403, 405, 429]) {
      assert.equal(shouldReportServerError({ statusCode: status }), false, `status ${status}`);
    }
  });

  it('reports 5xx, including the CMS-unavailable 503', () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(shouldReportServerError({ statusCode: status }), true, `status ${status}`);
    }
  });

  it('reports unclassified crashes', () => {
    assert.equal(shouldReportServerError(new TypeError('x is not a function')), true);
    assert.equal(shouldReportServerError('boom'), true);
  });
});

describe('redactErrorPath', () => {
  it('drops the query string, which can hold a live magic-link token', () => {
    assert.equal(redactErrorPath('/auth/verify?token=abc123'), '/auth/verify');
    assert.equal(redactErrorPath('/auth/verify#token=abc123'), '/auth/verify');
  });

  it('masks identifier-looking segments', () => {
    assert.equal(redactErrorPath('/watch/1b4e28ba-2fa1-11d2-883f-0016d3cca427'), '/watch/:id');
    assert.equal(redactErrorPath('/download/0123456789abcdef0123'), '/download/:token');
    assert.equal(redactErrorPath('/account/1234567'), '/account/:id');
    assert.equal(redactErrorPath(`/x/${'a'.repeat(41)}`), '/x/:token');
  });

  it('leaves route shape intact', () => {
    assert.equal(redactErrorPath('/videos/my-video-slug'), '/videos/my-video-slug');
    assert.equal(redactErrorPath('/'), '/');
  });
});

describe('serverErrorProperties', () => {
  it('carries route context, status and deploy tier', () => {
    const props = serverErrorProperties(
      { statusCode: 503 },
      { path: '/privacy', method: 'GET' },
      'production',
    );
    assert.deepEqual(props, {
      $process_person_profile: false,
      $environment: 'production',
      path: '/privacy',
      method: 'GET',
      status_code: 503,
    });
  });

  it('omits absent context and falls back to development', () => {
    assert.deepEqual(serverErrorProperties(new Error('boom'), undefined, ''), {
      $process_person_profile: false,
      $environment: 'development',
    });
  });

  it('never forwards a query string from the request path', () => {
    const props = serverErrorProperties(
      new Error('boom'),
      { path: '/auth/verify?token=super-secret', method: 'GET' },
      'production',
    );
    assert.equal(props.path, '/auth/verify');
    assert.equal(JSON.stringify(props).includes('super-secret'), false);
  });
});
