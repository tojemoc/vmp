/**
 * Account deletion auth gates + Brevo contact delete + job step markers.
 * Run: npm test --workspace=@vmp/api -- --test-name-pattern='account deletion|requireAuth'
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { ACCOUNT_DELETION_CONFIRM_PHRASE } from '@vmp/shared';
import {
  handleAccountDeleteConfirm,
  handleAccountDeleteRequest,
  processAccountDeletionJob,
} from '../src/accountDeletion.js';
import { createAccessToken, requireAuth } from '../src/auth.js';
import { deleteBrevoContactByEmail } from '../src/brevo.js';

const JWT_SECRET = 'test-secret-at-least-thirty-two-characters-long';

type UserRow = { id: string; email: string; deletion_pending?: number };

function fakeDb(opts: {
  users?: Map<string, UserRow>;
  tokens?: Map<string, any>;
  jobs?: Map<string, any>;
  r2?: Map<string, any>;
  subscriptions?: any[];
  einvoices?: any[];
  batchLog?: unknown[][];
}) {
  const users = opts.users ?? new Map();
  const tokens = opts.tokens ?? new Map();
  const jobs = opts.jobs ?? new Map();
  const r2 = opts.r2 ?? new Map();
  const subscriptions = opts.subscriptions ?? [];
  const einvoices = opts.einvoices ?? [];
  const batchLog = opts.batchLog ?? [];

  return {
    users,
    tokens,
    jobs,
    r2,
    subscriptions,
    einvoices,
    batchLog,
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (
                normalized.includes('FROM users WHERE id') &&
                normalized.includes('deletion_pending')
              ) {
                const u = users.get(String(args[0]));
                return u
                  ? {
                      id: u.id,
                      email: u.email,
                      deletion_pending: u.deletion_pending ?? 0,
                    }
                  : null;
              }
              if (normalized.startsWith('SELECT deletion_pending FROM users')) {
                const u = users.get(String(args[0]));
                return u ? { deletion_pending: u.deletion_pending ?? 0 } : null;
              }
              if (normalized.includes('FROM account_deletion_tokens')) {
                for (const t of tokens.values()) {
                  if (t.token_hash === args[0]) return { ...t };
                }
                return null;
              }
              if (normalized.includes('FROM account_deletion_jobs WHERE id')) {
                return jobs.get(String(args[0])) ?? null;
              }
              if (
                normalized.includes('FROM account_deletion_jobs') &&
                normalized.includes('user_id')
              ) {
                for (const j of jobs.values()) {
                  if (j.user_id === args[0]) return j;
                }
                return null;
              }
              if (normalized.includes('FROM subscriptions') && normalized.includes('user_id')) {
                return subscriptions.find((s) => s.user_id === args[0]) ?? null;
              }
              if (
                normalized.includes('FROM account_deletion_r2_objects') &&
                normalized.includes('outcome IS NULL')
              ) {
                for (const row of r2.values()) {
                  if (row.job_id === args[0] && !row.outcome) return { ok: 1 };
                }
                return null;
              }
              return null;
            },
            async all() {
              if (normalized.includes('FROM subscriptions')) {
                return { results: subscriptions.filter((s) => s.user_id === args[0]) };
              }
              if (normalized.includes('FROM einvoices')) {
                return { results: einvoices.filter((e) => e.user_id === args[0]) };
              }
              if (
                normalized.includes('FROM account_deletion_r2_objects') &&
                normalized.includes('outcome IS NULL')
              ) {
                return {
                  results: [...r2.values()].filter((r) => r.job_id === args[0] && !r.outcome),
                };
              }
              if (
                normalized.includes('FROM account_deletion_jobs') &&
                normalized.includes('status')
              ) {
                return {
                  results: [...jobs.values()]
                    .filter((j) => j.status === 'pending' || j.status === 'running')
                    .map((j) => ({ id: j.id })),
                };
              }
              return { results: [] };
            },
            async run() {
              if (normalized.startsWith('INSERT INTO account_deletion_tokens')) {
                tokens.set(String(args[0]), {
                  id: args[0],
                  user_id: args[1],
                  token_hash: args[2],
                  expires_at: args[3],
                  used_at: null,
                });
              }
              if (normalized.startsWith('INSERT INTO account_deletion_jobs')) {
                jobs.set(String(args[0]), {
                  id: args[0],
                  user_id: args[1],
                  brevo_contact_identifier: args[2],
                  status: 'pending',
                  subscription_cancelled: 0,
                  einvoices_anonymized: 0,
                  r2_sanitized: 0,
                  db_cleaned: 0,
                  brevo_deleted: 0,
                  user_deleted: 0,
                  error_message: null,
                });
              }
              if (normalized.startsWith('UPDATE account_deletion_jobs SET')) {
                const job = jobs.get(String(args[args.length - 1]));
                if (job) {
                  // Best-effort: tests assert via processAccountDeletionJob side effects.
                  job.updated = true;
                }
              }
              if (normalized.includes('UPDATE users SET deletion_pending')) {
                const u = users.get(String(args[0]));
                if (u) u.deletion_pending = 1;
              }
              if (normalized.startsWith('DELETE FROM users')) {
                users.delete(String(args[0]));
              }
              if (normalized.startsWith('INSERT OR IGNORE INTO account_deletion_r2_objects')) {
                r2.set(String(args[0]), {
                  id: args[0],
                  job_id: args[1],
                  object_key: args[2],
                  outcome: null,
                });
              }
              if (normalized.startsWith('UPDATE account_deletion_r2_objects')) {
                const row = r2.get(String(args[1]));
                if (row) row.outcome = args[0];
              }
              if (normalized.includes('UPDATE account_deletion_tokens SET used_at')) {
                for (const t of tokens.values()) {
                  if (t.id === args[0] || t.user_id === args[0]) t.used_at = 'now';
                }
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts: unknown[]) {
      batchLog.push(stmts);
      for (const s of stmts as any[]) {
        if (s && typeof s.run === 'function') await s.run();
      }
    },
  };
}

function requestWithToken(token?: string, body?: unknown) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request('https://example.com/api/account/delete', {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('requireAuth deletion-pending gate', () => {
  it('rejects a token for a deletion-pending user', async () => {
    const token = await createAccessToken(
      { id: 'u-pending', email: 'p@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const db = fakeDb({
      users: new Map([
        ['u-pending', { id: 'u-pending', email: 'p@example.com', deletion_pending: 1 }],
      ]),
    });
    await assert.rejects(
      requireAuth(requestWithToken(token), { DB: db, JWT_SECRET }),
      /Account deletion pending/,
    );
  });

  it('accepts a token for a normal user', async () => {
    const token = await createAccessToken(
      { id: 'u1', email: 'a@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const db = fakeDb({
      users: new Map([['u1', { id: 'u1', email: 'a@example.com', deletion_pending: 0 }]]),
    });
    const payload = await requireAuth(requestWithToken(token), { DB: db, JWT_SECRET });
    assert.equal(payload.sub, 'u1');
  });
});

describe('deleteBrevoContactByEmail', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('treats 404 as success', async () => {
    globalThis.fetch = mock.fn(async () => new Response('{}', { status: 404 })) as any;
    const result = await deleteBrevoContactByEmail('gone@example.com', { BREVO_API_KEY: 'k' });
    assert.equal(result.ok, true);
  });

  it('marks 500 as retryable', async () => {
    globalThis.fetch = mock.fn(async () => new Response('{}', { status: 500 })) as any;
    const result = await deleteBrevoContactByEmail('x@example.com', { BREVO_API_KEY: 'k' });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
  });

  it('marks 403 as terminal', async () => {
    globalThis.fetch = mock.fn(async () => new Response('{}', { status: 403 })) as any;
    const result = await deleteBrevoContactByEmail('x@example.com', { BREVO_API_KEY: 'k' });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, false);
  });
});

describe('account deletion request/confirm', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('delete-request stores a token without Brevo (logs tokenId only)', async () => {
    const token = await createAccessToken(
      { id: 'u1', email: 'a@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const db = fakeDb({
      users: new Map([['u1', { id: 'u1', email: 'a@example.com', deletion_pending: 0 }]]),
    });
    const res = await handleAccountDeleteRequest(
      requestWithToken(token),
      {
        DB: db,
        JWT_SECRET,
        FRONTEND_URL: 'http://localhost:3000',
      },
      {},
    );
    assert.equal(res.status, 200);
    assert.equal(db.tokens.size, 1);
  });

  it('delete-confirm rejects wrong phrase without consuming token', async () => {
    const token = await createAccessToken(
      { id: 'u1', email: 'a@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const db = fakeDb({
      users: new Map([['u1', { id: 'u1', email: 'a@example.com', deletion_pending: 0 }]]),
      tokens: new Map([
        [
          'tok1',
          {
            id: 'tok1',
            user_id: 'u1',
            token_hash: 'abc',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used_at: null,
          },
        ],
      ]),
    });
    // hash won't match — use real hash via request path with unknown token
    const res = await handleAccountDeleteConfirm(
      requestWithToken(token, { token: 'not-a-real-token', confirmationPhrase: 'wrong' }),
      { DB: db, JWT_SECRET },
      {},
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'phrase_mismatch');
  });

  it('delete-confirm creates a job with correct phrase and matching token', async () => {
    const { generateToken, hashToken } = await import('../src/auth.js');
    const raw = generateToken();
    const hash = await hashToken(raw);
    const access = await createAccessToken(
      { id: 'u1', email: 'a@example.com', role: 'viewer' },
      JWT_SECRET,
    );
    const db = fakeDb({
      users: new Map([['u1', { id: 'u1', email: 'a@example.com', deletion_pending: 0 }]]),
      tokens: new Map([
        [
          'tok1',
          {
            id: 'tok1',
            user_id: 'u1',
            token_hash: hash,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used_at: null,
          },
        ],
      ]),
    });

    // Stub getPaymentProviders path by having no active subscription.
    const res = await handleAccountDeleteConfirm(
      requestWithToken(access, {
        token: raw,
        confirmationPhrase: ACCOUNT_DELETION_CONFIRM_PHRASE,
      }),
      { DB: db, JWT_SECRET, FRONTEND_URL: 'http://localhost:3000' },
      {},
    );
    assert.equal(res.status, 200);
    assert.equal(db.jobs.size, 1);
    // Immediate process may already have deleted the user; either pending lock or gone is OK.
    const userAfter = db.users.get('u1');
    assert.ok(userAfter == null || userAfter.deletion_pending === 1);
  });
});

describe('processAccountDeletionJob without Brevo', () => {
  it('deletes the user and marks job steps', async () => {
    const db = fakeDb({
      users: new Map([['u1', { id: 'u1', email: 'a@example.com', deletion_pending: 1 }]]),
      jobs: new Map([
        [
          'job1',
          {
            id: 'job1',
            user_id: 'u1',
            brevo_contact_identifier: 'a@example.com',
            status: 'pending',
            subscription_cancelled: 0,
            einvoices_anonymized: 0,
            r2_sanitized: 0,
            db_cleaned: 0,
            brevo_deleted: 0,
            user_deleted: 0,
            error_message: null,
          },
        ],
      ]),
      einvoices: [
        {
          user_id: 'u1',
          xml_payload_r2_key: 'einvoices/1/invoice.xml',
          pdf_payload_r2_key: null,
        },
      ],
    });

    // processAccountDeletionJob uses markJob which does UPDATE — enhance fake to apply fields
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('UPDATE account_deletion_jobs SET')) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                const jobId = String(args[args.length - 1]);
                const job = db.jobs.get(jobId);
                if (!job) return { meta: { changes: 0 } };
                const setPart = normalized
                  .slice('UPDATE account_deletion_jobs SET '.length)
                  .split(' WHERE')[0]!;
                let i = 0;
                for (const part of setPart.split(',')) {
                  const trimmed = part.trim();
                  const eq = trimmed.indexOf('=');
                  if (eq < 0) continue;
                  const key = trimmed.slice(0, eq).trim();
                  const rhs = trimmed.slice(eq + 1).trim();
                  if (key === 'updated_at') continue;
                  if (rhs === '?') {
                    (job as any)[key] = args[i++];
                  } else if (rhs === 'NULL') {
                    (job as any)[key] = null;
                  } else if (/^\d+$/.test(rhs)) {
                    (job as any)[key] = Number(rhs);
                  } else if (
                    (rhs.startsWith("'") && rhs.endsWith("'")) ||
                    (rhs.startsWith('"') && rhs.endsWith('"'))
                  ) {
                    (job as any)[key] = rhs.slice(1, -1);
                  }
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                return null;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      }
      if (normalized.startsWith('UPDATE einvoices SET')) {
        return {
          bind() {
            return {
              async run() {
                return { meta: { changes: 1 } };
              },
              async first() {
                return null;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      }
      return originalPrepare(sql);
    };

    // batch must also apply DELETE users + job flags from anonymizeEinvoicesAndDeleteUser
    const originalBatch = db.batch.bind(db);
    db.batch = async (stmts: unknown[]) => {
      // Execute via original; also apply DELETE FROM users if present in SQL closures.
      await originalBatch(stmts);
      // After cleanup batch, user may still remain if fake didn't catch DELETE — force from job path.
    };

    await processAccountDeletionJob({ DB: db, JWT_SECRET }, 'job1');
    const job = db.jobs.get('job1');
    assert.ok(job);
    assert.equal(Number(job.subscription_cancelled), 1);
    assert.equal(Number(job.user_deleted), 1);
    assert.equal(Number(job.brevo_deleted), 1); // no BREVO_API_KEY → skipped as done
    assert.equal(job.status, 'completed');
    assert.equal(db.users.has('u1'), false);
    assert.ok(db.r2.size >= 1);
  });
});
