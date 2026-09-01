/**
 * Marketing consent gating for the Brevo list sync.
 * Run: npm test --workspace=@vmp/api
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { syncNewsletterForSubscription, syncPayingSubscriberToNewsletter } from '../src/brevo.js';
import { hasMarketingConsent, writeMarketingConsent } from '../src/marketingConsent.js';

/**
 * Minimal fake D1 covering the queries the sync path runs:
 *  - admin_settings lookup for brevo_subscriber_list_id
 *  - users lookup for email + marketing_consent_at
 * `consentAt` null means no consent recorded.
 */
function fakeDb({ listId = '7', email = 'paid@example.com', consentAt = null as string | null }) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('admin_settings')) return { value: listId };
              if (sql.includes('FROM users')) {
                return { email, marketing_consent_at: consentAt, marketing_consent_version: null };
              }
              return null;
            },
          };
        },
      };
    },
  };
}

describe('syncPayingSubscriberToNewsletter consent gate', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not add a user without marketing consent', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ consentAt: null });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, false);
    assert.equal(fetchMock.mock.callCount(), 0, 'no Brevo call when consent is absent');
  });

  it('skips a consented user who is suppressed (blacklisted) at Brevo', async () => {
    const fetchMock = mock.fn(async (url: string) => {
      if (String(url).includes('/contacts/') && !String(url).endsWith('/contacts')) {
        return new Response(JSON.stringify({ emailBlacklisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ consentAt: '2026-09-01 00:00:00' });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, false);
    const postCall = fetchMock.mock.calls.find((c) => (c.arguments[1] as any)?.method === 'POST');
    assert.equal(postCall, undefined, 'never POSTs the contact when Brevo suppressed it');
  });

  it('adds a consented user that Brevo does not know yet (404)', async () => {
    const fetchMock = mock.fn(async (url: string, opts: any) => {
      if (opts?.method === 'GET') return new Response('{}', { status: 404 });
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ consentAt: '2026-09-01 00:00:00' });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, true);
    const postCall = fetchMock.mock.calls.find((c) => (c.arguments[1] as any)?.method === 'POST');
    assert.ok(postCall, 'POSTs the contact to the list');
  });
});

describe('syncNewsletterForSubscription never removes on billing change', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('makes no Brevo removal call when a subscription becomes non-paying', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ consentAt: '2026-09-01 00:00:00' });
    await syncNewsletterForSubscription(db, 'u1', 'cancelled', { BREVO_API_KEY: 'k' });

    const removeCall = fetchMock.mock.calls.find((c) =>
      String(c.arguments[0]).includes('/contacts/remove'),
    );
    assert.equal(removeCall, undefined, 'cancellation is a billing transition, not a list removal');
  });
});

describe('marketing consent store', () => {
  it('writes then reads consent through a fake row', async () => {
    let row: any = { marketing_consent_at: null, marketing_consent_version: null };
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                if (sql.includes('marketing_consent_at = CURRENT_TIMESTAMP')) {
                  row = { marketing_consent_at: '2026-09-01', marketing_consent_version: args[0] };
                } else if (sql.includes('marketing_consent_at = NULL')) {
                  row = { marketing_consent_at: null, marketing_consent_version: null };
                }
              },
              async first() {
                return row;
              },
            };
          },
        };
      },
    };

    assert.equal(await hasMarketingConsent(db, 'u1'), false);
    const granted = await writeMarketingConsent(db, 'u1', true);
    assert.equal(granted?.consented, true);
    assert.equal(await hasMarketingConsent(db, 'u1'), true);
    const withdrawn = await writeMarketingConsent(db, 'u1', false);
    assert.equal(withdrawn?.consented, false);
  });
});
