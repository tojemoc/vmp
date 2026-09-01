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

  it('does not treat generic aborted substrings as benign', () => {
    assert.equal(isBenignAbortError(new Error('Connection aborted')), false);
    assert.equal(isBenignAbortError(new Error('Upload was aborted by server policy')), false);
  });

  it('drops PostHog exception events for AbortError', () => {
    assert.equal(
      shouldDropPostHogExceptionEvent({
        uuid: '1',
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

  it('keeps PostHog exceptions whose message only contains aborted', () => {
    assert.equal(
      shouldDropPostHogExceptionEvent({
        uuid: '2',
        event: '$exception',
        properties: {
          $exception_list: [{ type: 'Error', value: 'Error', message: 'Connection aborted' }],
        },
      }),
      false,
    );
  });

  it('keeps non-exception PostHog events', () => {
    assert.equal(
      shouldDropPostHogExceptionEvent({
        uuid: '3',
        event: 'subscription_activated',
        properties: {},
      }),
      false,
    );
  });
});
