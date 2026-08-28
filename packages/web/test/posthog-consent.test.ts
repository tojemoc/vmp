import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  applyPostHogConsentToClient,
  applyStoredPostHogConsentToClient,
  canCapturePostHogAnalytics,
  POSTHOG_ANALYTICS_CONSENT_KEY,
} from '../utils/posthogConsent';

describe('applyStoredPostHogConsentToClient', () => {
  let optedIn = false;
  let optedOut = false;

  beforeEach(() => {
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
      opt_in_capturing: () => {
        optedIn = true;
      },
      opt_out_capturing: () => {
        optedOut = true;
      },
    };
  }

  it('opts in when consent was already granted', () => {
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
  });

  it('opts out when consent was denied (cookieless on_reject)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) =>
          key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'denied' : null,
        setItem: () => {},
      },
    });

    applyStoredPostHogConsentToClient(client());

    assert.equal(optedIn, false);
    assert.equal(optedOut, true);
  });

  it('leaves PostHog pending when consent is unset', () => {
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
    assert.equal(optedOut, false);
  });
});

describe('canCapturePostHogAnalytics', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it('allows capture when consent is granted', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) =>
          key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'granted' : null,
        setItem: () => {},
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { posthog: { is_capturing: () => false } },
    });

    assert.equal(canCapturePostHogAnalytics(), true);
  });

  it('allows capture in cookieless mode when PostHog is capturing after deny', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) =>
          key === POSTHOG_ANALYTICS_CONSENT_KEY ? 'denied' : null,
        setItem: () => {},
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { posthog: { is_capturing: () => true } },
    });

    assert.equal(canCapturePostHogAnalytics(), true);
  });

  it('applyPostHogConsentToClient delegates to opt_in/opt_out only', () => {
    let optedIn = false;
    let optedOut = false;
    const ph = {
      opt_in_capturing: () => {
        optedIn = true;
      },
      opt_out_capturing: () => {
        optedOut = true;
      },
      set_config: () => {
        throw new Error('should not set persistence manually');
      },
    };

    applyPostHogConsentToClient(ph, true);
    assert.equal(optedIn, true);
    assert.equal(optedOut, false);

    applyPostHogConsentToClient(ph, false);
    assert.equal(optedOut, true);
  });
});
