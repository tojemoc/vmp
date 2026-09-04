/**
 * Newsletter opt-out gating for the Brevo marketing list sync.
 * Run: npm test --workspace=@vmp/api
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  reconcileNewsletterMembershipForUser,
  syncNewsletterForSubscription,
  syncPayingSubscriberToNewsletter,
} from '../src/brevo.js';
import {
  applyCheckoutNewsletterOptOut,
  hasNewsletterOptOut,
  writeNewsletterPreference,
} from '../src/newsletterPreference.js';

/**
 * Minimal fake D1 covering the queries the sync path runs:
 *  - admin_settings lookup for brevo_subscriber_list_id
 *  - users lookup for email + newsletter_opted_out_at
 *  - optional subscriptions paying check
 * `optedOutAt` null means default (receive newsletter).
 */
function fakeDb({
  listId = '7',
  email = 'paid@example.com',
  optedOutAt = null as string | null,
  paying = true,
}) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('admin_settings')) return { value: listId };
              if (sql.includes('FROM subscriptions')) {
                return paying ? { ok: 1 } : null;
              }
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

  it('skips when listUnsubscribed contains the configured list id', async () => {
    const fetchMock = mock.fn(async (url: string, opts: any) => {
      if (opts?.method === 'GET') {
        return new Response(JSON.stringify({ emailBlacklisted: false, listUnsubscribed: [7] }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ optedOutAt: null, listId: '7' });
    const added = await syncPayingSubscriberToNewsletter(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(added, false);
    const postCall = fetchMock.mock.calls.find((c) => (c.arguments[1] as any)?.method === 'POST');
    assert.equal(postCall, undefined, 'never POSTs when list-unsubscribed');
  });
});

describe('reconcileNewsletterMembershipForUser', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not add a non-paying user who cleared opt-out', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const db = fakeDb({ optedOutAt: null, paying: false });
    const ok = await reconcileNewsletterMembershipForUser(db, 'u1', { BREVO_API_KEY: 'k' });

    assert.equal(ok, true);
    const addCall = fetchMock.mock.calls.find(
      (c) =>
        (c.arguments[1] as any)?.method === 'POST' &&
        String(c.arguments[0]).endsWith('/contacts') &&
        !String(c.arguments[0]).includes('/remove'),
    );
    assert.equal(addCall, undefined, 'non-paying opted-in user is never added');
    const removeCall = fetchMock.mock.calls.find((c) =>
      String(c.arguments[0]).includes('/contacts/remove'),
    );
    assert.ok(removeCall, 'keeps non-paying user off the marketing list');
  });

  it('enqueues reconcile when removal through reconcile fails', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 500 }));
    globalThis.fetch = fetchMock as any;

    let enqueued = false;
    const base = fakeDb({ optedOutAt: '2026-09-04 00:00:00', paying: true });
    const db = {
      prepare(sql: string) {
        if (sql.includes('newsletter_brevo_reconcile_queue')) {
          return {
            bind() {
              return {
                async run() {
                  enqueued = true;
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        }
        return base.prepare(sql);
      },
    };

    const ok = await reconcileNewsletterMembershipForUser(db, 'u1', { BREVO_API_KEY: 'k' });
    assert.equal(ok, false);
    assert.equal(enqueued, true, 'failed reconcile removal is queued for durable retry');
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

  it('enqueues reconcile when non-paying removal fails', async () => {
    const fetchMock = mock.fn(async () => new Response('{}', { status: 500 }));
    globalThis.fetch = fetchMock as any;

    let enqueued = false;
    const base = fakeDb({ optedOutAt: null });
    const db = {
      prepare(sql: string) {
        if (sql.includes('newsletter_brevo_reconcile_queue')) {
          return {
            bind() {
              return {
                async run() {
                  enqueued = true;
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        }
        return base.prepare(sql);
      },
    };

    await syncNewsletterForSubscription(db, 'u1', 'cancelled', { BREVO_API_KEY: 'k' });
    assert.equal(enqueued, true, 'failed removal is queued for durable retry');
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

  it('checkout false/omitted does not clear a prior opt-out', async () => {
    let row: any = {
      newsletter_opted_out_at: '2026-09-01',
      newsletter_opt_out_version: '2026-09-04',
    };
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

    const unchanged = await applyCheckoutNewsletterOptOut(db, 'u1', false);
    assert.equal(unchanged?.optedOut, true, 'unchecked checkout keeps prior opt-out');

    const stillUnchanged = await applyCheckoutNewsletterOptOut(db, 'u1', false);
    assert.equal(stillUnchanged?.optedOut, true);

    const setFromCheckout = await applyCheckoutNewsletterOptOut(db, 'u1', true);
    assert.equal(setFromCheckout?.optedOut, true);
  });
});
