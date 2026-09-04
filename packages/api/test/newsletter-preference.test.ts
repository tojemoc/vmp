/**
 * Newsletter opt-out gating for the Brevo marketing list sync.
 * Run: npm test --workspace=@vmp/api
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { syncNewsletterForSubscription, syncPayingSubscriberToNewsletter } from '../src/brevo.js';
import { hasNewsletterOptOut, writeNewsletterPreference } from '../src/newsletterPreference.js';

/**
 * Minimal fake D1 covering the queries the sync path runs:
 *  - admin_settings lookup for brevo_subscriber_list_id
 *  - users lookup for email + newsletter_opted_out_at
 * `optedOutAt` null means default (receive newsletter).
 */
function fakeDb({
  listId = '7',
  email = 'paid@example.com',
  optedOutAt = null as string | null,
}) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('admin_settings')) return { value: listId };
              if (sql.includes('FROM users')) {
                return {
                  email,
                  newsletter_opted_out_at: optedOutAt,
                  newsletter_opt_out_version: null,
                };
              }
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

describe('syncPayingSubscriberToNewsletter opt-out gate', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('adds a paying user who has not opted out', async () => {
    const fetchMock = mock.fn(async (url: string, opts: any) => {
      if (opts?.method === 'GET') return new Response('{}', { status: 404 });
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ optedOutAt: null });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, true);
    const postCall = fetchMock.mock.calls.find((c) => (c.arguments[1] as any)?.method === 'POST');
    assert.ok(postCall, 'POSTs the contact to the list');
  });

  it('does not add an opted-out user and removes them from the list', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ optedOutAt: '2026-09-04 00:00:00' });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, false);
    const removeCall = fetchMock.mock.calls.find((c) =>
      String(c.arguments[0]).includes('/contacts/remove'),
    );
    assert.ok(removeCall, 'removes opted-out contact from the marketing list');
    const addCall = fetchMock.mock.calls.find(
      (c) =>
        (c.arguments[1] as any)?.method === 'POST' &&
        String(c.arguments[0]).endsWith('/contacts'),
    );
    assert.equal(addCall, undefined, 'never POSTs an opted-out contact onto the list');
  });

  it('skips a non-opted-out user who is suppressed (blacklisted) at Brevo', async () => {
    const fetchMock = mock.fn(async (url: string) => {
      if (String(url).includes('/contacts/') && !String(url).endsWith('/contacts')) {
        return new Response(JSON.stringify({ emailBlacklisted: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ optedOutAt: null });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, false);
    const postCall = fetchMock.mock.calls.find((c) => (c.arguments[1] as any)?.method === 'POST');
    assert.equal(postCall, undefined, 'never POSTs the contact when Brevo suppressed it');
  });
});

describe('syncNewsletterForSubscription billing transitions', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('removes from the marketing list when a subscription becomes non-paying', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ optedOutAt: null });
    await syncNewsletterForSubscription(db, 'u1', 'cancelled', { BREVO_API_KEY: 'k' });

    const removeCall = fetchMock.mock.calls.find((c) =>
      String(c.arguments[0]).includes('/contacts/remove'),
    );
    assert.ok(removeCall, 'cancellation removes the contact from the newsletter list');
  });
});

describe('newsletter preference store', () => {
  it('writes then reads opt-out through a fake row', async () => {
    let row: any = { newsletter_opted_out_at: null, newsletter_opt_out_version: null };
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                if (sql.includes('newsletter_opted_out_at = CURRENT_TIMESTAMP')) {
                  row = {
                    newsletter_opted_out_at: '2026-09-04',
                    newsletter_opt_out_version: args[0],
                  };
                } else if (sql.includes('newsletter_opted_out_at = NULL')) {
                  row = { newsletter_opted_out_at: null, newsletter_opt_out_version: null };
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

    assert.equal(await hasNewsletterOptOut(db, 'u1'), false);
    const opted = await writeNewsletterPreference(db, 'u1', true);
    assert.equal(opted?.optedOut, true);
    assert.equal(await hasNewsletterOptOut(db, 'u1'), true);
    const cleared = await writeNewsletterPreference(db, 'u1', false);
    assert.equal(cleared?.optedOut, false);
  });
});
