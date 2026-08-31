import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isBenignAbortError,
  shouldDropPostHogExceptionEvent,
} from '../utils/analytics/noiseFilter';

describe('analytics noiseFilter', () => {
  it('treats DOMException AbortError as benign', () => {
    assert.equal(isBenignAbortError(new DOMException('Request aborted', 'AbortError')), true);
  });

  it('treats Error AbortError as benign', () => {
    const err = new Error('Request aborted');
    err.name = 'AbortError';
    assert.equal(isBenignAbortError(err), true);
  });

  it('does not treat unrelated errors as benign', () => {
    assert.equal(isBenignAbortError(new Error('Network failed')), false);
  });

  it('drops PostHog exception events for AbortError', () => {
    assert.equal(
      shouldDropPostHogExceptionEvent({
        event: '$exception',
        properties: {
          $exception_list: [
            { type: 'DOMException', value: 'AbortError', message: 'Request aborted' },
          ],
        },
      }),
      true,
    );
  });

  it('keeps non-exception PostHog events', () => {
    assert.equal(
      shouldDropPostHogExceptionEvent({ event: 'subscription_activated', properties: {} }),
      false,
    );
  });
});
