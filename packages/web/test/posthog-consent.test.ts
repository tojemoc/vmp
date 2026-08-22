import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  applyStoredPostHogConsentToClient,
  POSTHOG_ANALYTICS_CONSENT_KEY,
} from '../utils/posthogConsent';

describe('applyStoredPostHogConsentToClient', () => {
  let persistence: string | undefined;
  let optedIn = false;
  let optedOut = false;

  beforeEach(() => {
    persistence = undefined;
    optedIn = false;
    optedOut = false;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {},
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  function client() {
    return {
      set_config: (config: { persistence?: string }) => {
        persistence = config.persistence;
      },
      opt_in_capturing: () => {
        optedIn = true;
      },
      opt_out_capturing: () => {
        optedOut = true;
      },
    };
  }

  it('opts in and switches persistence when consent was already granted', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) =>
          key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'granted' : null,
        setItem: () => {},
      },
    });

    applyStoredPostHogConsentToClient(client());

    assert.equal(optedIn, true);
    assert.equal(optedOut, false);
    assert.equal(persistence, 'localStorage+cookie');
  });

  it('opts out when consent was denied or unset', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: () => null,
        setItem: () => {},
      },
    });

    applyStoredPostHogConsentToClient(client());

    assert.equal(optedIn, false);
    assert.equal(optedOut, true);
    assert.equal(persistence, 'memory');
  });
});
