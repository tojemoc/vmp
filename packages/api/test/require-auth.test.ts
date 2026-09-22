import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createAccessToken, requireAuth } from '../src/auth.js';
import { resetD1OptionalColumnCache } from '../src/d1OptionalColumn.js';

const JWT_SECRET = 'test-secret-at-least-thirty-two-characters-long';

// Minimal D1 double: the `users` map holds rows that still exist (with deletion_pending).
function fakeDb(users: Map<string, { deletion_pending?: number }>) {
  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (normalized.includes('FROM users WHERE id')) {
                const row = users.get(String(args[0]));
                if (!row) return null;
                return { deletion_pending: row.deletion_pending ?? 0 };
              }
              return null;
            },
          };
        },
      };
    },
  };
}

function requestWithToken(token?: string) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request('https://example.com/api/protected', { headers });
}

describe('requireAuth account existence', () => {
  afterEach(() => {
    resetD1OptionalColumnCache();
  });

  it('accepts a token whose user row still exists', async () => {
    const token = await createAccessToken(
      { id: 'user-1', email: 'viewer@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const env = { DB: fakeDb(new Map([['user-1', {}]])), JWT_SECRET };
    const payload = await requireAuth(requestWithToken(token), env);
    assert.equal(payload.sub, 'user-1');
  });

  it('rejects a valid token for a deleted user', async () => {
    const token = await createAccessToken(
      { id: 'deleted-user', email: 'gone@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const env = { DB: fakeDb(new Map()), JWT_SECRET };
    await assert.rejects(requireAuth(requestWithToken(token), env), /User no longer exists/);
  });

  it('rejects a token for a deletion-pending user', async () => {
    const token = await createAccessToken(
      { id: 'pending-user', email: 'p@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const env = {
      DB: fakeDb(new Map([['pending-user', { deletion_pending: 1 }]])),
      JWT_SECRET,
    };
    await assert.rejects(requireAuth(requestWithToken(token), env), /Account deletion pending/);
  });

  it('accepts a token when D1 has not yet gained users.deletion_pending', async () => {
    const token = await createAccessToken(
      { id: 'user-1', email: 'viewer@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              return {
                async first() {
                  if (sql.includes('deletion_pending')) {
                    throw new Error(
                      'D1_ERROR: no such column: u.deletion_pending at offset 110: SQLITE_ERROR',
                    );
                  }
                  if (sql.includes('FROM users WHERE id')) {
                    return args[0] === 'user-1' ? { id: 'user-1' } : null;
                  }
                  return null;
                },
              };
            },
          };
        },
      },
      JWT_SECRET,
    };
    const payload = await requireAuth(requestWithToken(token), env);
    assert.equal(payload.sub, 'user-1');
  });

  it('rejects when the Authorization header is missing', async () => {
    const env = { DB: fakeDb(new Map([['user-1', {}]])), JWT_SECRET };
    await assert.rejects(requireAuth(requestWithToken(), env), /Missing Bearer token/);
  });
});
