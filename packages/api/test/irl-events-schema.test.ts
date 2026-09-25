import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createAccessToken } from '../src/auth.js';
import { resetD1OptionalColumnCache } from '../src/d1OptionalColumn.js';
import { handleListAccountIrlEvents, isMissingIrlSchemaError } from '../src/irlEvents.js';

const JWT_SECRET = 'test-secret-at-least-thirty-two-characters-long';

const MISSING_IRL_EVENTS = new Error('D1_ERROR: no such table: irl_events: SQLITE_ERROR');

function requestWithToken(token: string) {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  return new Request('https://example.com/api/account/irl-events', { headers });
}

function fakeDbMissingIrlTable() {
  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(..._args: unknown[]) {
          return {
            async first() {
              if (normalized.includes('FROM users WHERE id')) {
                return { deletion_pending: 0 };
              }
              if (normalized.includes('FROM subscriptions')) {
                return { plan_type: 'club' };
              }
              if (normalized.includes('irl_events') || normalized.includes('irl_event_rsvps')) {
                throw MISSING_IRL_EVENTS;
              }
              return null;
            },
            async all() {
              if (normalized.includes('irl_events') || normalized.includes('irl_event_rsvps')) {
                throw MISSING_IRL_EVENTS;
              }
              return { results: [] };
            },
            async run() {
              if (normalized.includes('irl_events') || normalized.includes('irl_event_rsvps')) {
                throw MISSING_IRL_EVENTS;
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

afterEach(() => {
  resetD1OptionalColumnCache();
});

describe('isMissingIrlSchemaError', () => {
  it('matches the VMP-API-PRIMARY-C D1 signature', () => {
    assert.equal(isMissingIrlSchemaError(MISSING_IRL_EVENTS), true);
    assert.equal(isMissingIrlSchemaError(new Error('D1_ERROR: no such table: users')), false);
  });
});

describe('handleListAccountIrlEvents missing table', () => {
  it('returns 503 irl_schema_missing instead of throwing', async () => {
    const token = await createAccessToken(
      { id: 'user-1', email: 'club@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const res = await handleListAccountIrlEvents(
      requestWithToken(token),
      { DB: fakeDbMissingIrlTable(), JWT_SECRET },
      {},
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'irl_schema_missing');
    assert.equal(body.error, 'IRL events are temporarily unavailable');
  });
});
