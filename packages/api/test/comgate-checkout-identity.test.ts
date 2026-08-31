import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAmbiguousComgateChargeError,
  periodEndIsoForPlan,
  renewDueComgateSubscriptions,
  resolveComgateCheckoutIdentity,
} from '../src/paymentProcessor.js';

type Row = Record<string, unknown>;

class FakeDb {
  subscriptions: Row[];
  sessions: Row[];
  lastSql = '';
  lastArgs: unknown[] = [];

  constructor(opts?: { subscriptions?: Row[]; sessions?: Row[] }) {
    this.subscriptions = opts?.subscriptions ?? [];
    this.sessions = opts?.sessions ?? [];
  }

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        db.lastSql = sql;
        db.lastArgs = args;
        return this;
      },
      async first(): Promise<Row | null> {
        if (sql.includes('FROM subscriptions') && sql.includes("provider = 'comgate'")) {
          const [subscriptionId, purchaseId] = db.lastArgs as [string, string];
          return (
            db.subscriptions.find(
              (row) =>
                row.provider_subscription_id === subscriptionId ||
                row.purchase_id === purchaseId ||
                row.purchase_id === subscriptionId,
            ) ?? null
          );
        }
        if (sql.includes('FROM payment_checkout_sessions')) {
          const [tokenOrPurchase, checkoutId] = db.lastArgs as [string, string];
          return (
            db.sessions.find(
              (row) =>
                row.provider === 'comgate' &&
                row.status === 'pending' &&
                (row.checkout_token === tokenOrPurchase ||
                  row.provider_checkout_id === checkoutId ||
                  row.provider_checkout_id === tokenOrPurchase),
            ) ?? null
          );
        }
        return null;
      },
    };
  }
}

describe('resolveComgateCheckoutIdentity', () => {
  it('returns null when neither subscription nor pending session exists (first-checkout bug regression)', async () => {
    const db = new FakeDb();
    const result = await resolveComgateCheckoutIdentity(db, {
      subscriptionId: 'AB12-CD34-EF56',
      purchaseId: 'vmp-user1-1',
    });
    assert.equal(result, null);
  });

  it('resolves first-time subscriber from pending payment_checkout_sessions by refId', async () => {
    const db = new FakeDb({
      sessions: [
        {
          id: 'sess-1',
          provider: 'comgate',
          status: 'pending',
          checkout_token: 'vmp-user1-1',
          provider_checkout_id: 'AB12-CD34-EF56',
          user_id: 'user-1',
          plan_type: 'yearly',
        },
      ],
    });
    const result = await resolveComgateCheckoutIdentity(db, {
      subscriptionId: 'AB12-CD34-EF56',
      purchaseId: 'vmp-user1-1',
    });
    assert.deepEqual(result, {
      userId: 'user-1',
      planType: 'yearly',
      pendingSessionId: 'sess-1',
      fromPendingSession: true,
    });
  });

  it('resolves first-time subscriber from pending session by transId when refId missing', async () => {
    const db = new FakeDb({
      sessions: [
        {
          id: 'sess-2',
          provider: 'comgate',
          status: 'pending',
          checkout_token: 'vmp-user2-9',
          provider_checkout_id: 'ZZ99-YY88-XX77',
          user_id: 'user-2',
          plan_type: 'monthly',
        },
      ],
    });
    const result = await resolveComgateCheckoutIdentity(db, {
      subscriptionId: 'ZZ99-YY88-XX77',
      purchaseId: '',
    });
    assert.deepEqual(result, {
      userId: 'user-2',
      planType: 'monthly',
      pendingSessionId: 'sess-2',
      fromPendingSession: true,
    });
  });

  it('prefers existing subscription row over pending session on renewals', async () => {
    const db = new FakeDb({
      subscriptions: [
        {
          user_id: 'user-renew',
          plan_type: 'club',
          provider_subscription_id: 'AB12-CD34-EF56',
          purchase_id: 'vmp-user1-1',
        },
      ],
      sessions: [
        {
          id: 'sess-stale',
          provider: 'comgate',
          status: 'pending',
          checkout_token: 'vmp-user1-1',
          provider_checkout_id: 'AB12-CD34-EF56',
          user_id: 'should-not-win',
          plan_type: 'monthly',
        },
      ],
    });
    const result = await resolveComgateCheckoutIdentity(db, {
      subscriptionId: 'AB12-CD34-EF56',
      purchaseId: 'vmp-user1-1',
    });
    assert.deepEqual(result, {
      userId: 'user-renew',
      planType: 'club',
      pendingSessionId: null,
      fromPendingSession: false,
    });
  });

  it('ignores non-pending checkout sessions', async () => {
    const db = new FakeDb({
      sessions: [
        {
          id: 'sess-done',
          provider: 'comgate',
          status: 'completed',
          checkout_token: 'vmp-user1-1',
          provider_checkout_id: 'AB12-CD34-EF56',
          user_id: 'user-1',
          plan_type: 'monthly',
        },
      ],
    });
    const result = await resolveComgateCheckoutIdentity(db, {
      subscriptionId: 'AB12-CD34-EF56',
      purchaseId: 'vmp-user1-1',
    });
    assert.equal(result, null);
  });
});

describe('renewDueComgateSubscriptions', () => {
  function makeDb(opts: {
    due?: Array<Record<string, unknown>>;
    stale?: Array<Record<string, unknown>>;
    /** Affected rows for post-charge pending→charged UPDATE (default 1). */
    chargedChanges?: number;
  }) {
    const updates: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      updates,
      prepare(sql: string) {
        const stmt = {
          sql,
          args: [] as unknown[],
          bind(...args: unknown[]) {
            stmt.args = args;
            return stmt;
          },
          async all() {
            if (sql.includes("renewal_attempt_status IN ('pending', 'charged')")) {
              return { results: opts.stale ?? [] };
            }
            return { results: opts.due ?? [] };
          },
          async run() {
            updates.push({ sql: stmt.sql, args: stmt.args });
            const isChargedClaim =
              sql.includes("renewal_attempt_status = 'charged'") &&
              sql.includes('renewal_attempt_payment_id');
            const changes = isChargedClaim ? (opts.chargedChanges ?? 1) : 1;
            return { meta: { changes }, changes };
          },
        };
        return stmt;
      },
    };
    return db;
  }

  it('claims before charge and does not advance period until notification', async () => {
    const due = [
      {
        id: 'sub-1',
        user_id: 'user-1',
        plan_type: 'monthly',
        provider_subscription_id: 'AB12-CD34-EF56',
        email: 'a@example.com',
      },
    ];
    const db = makeDb({ due });
    const created: Array<Record<string, unknown>> = [];
    const result = await renewDueComgateSubscriptions(db, {
      createSubscription: async (input) => {
        created.push(input);
        return { lastPaymentId: 'RENEW-99-AA' };
      },
    });
    assert.equal(result.attempted, 1);
    assert.equal(result.renewed, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.initRecurringId, 'AB12-CD34-EF56');
    assert.equal(db.updates.length, 2);
    assert.match(String(db.updates[0]?.sql), /renewal_attempt_status = 'pending'/);
    assert.match(String(db.updates[1]?.sql), /renewal_attempt_status = 'charged'/);
    assert.match(String(db.updates[1]?.sql), /AND renewal_attempt_status = 'pending'/);
    assert.doesNotMatch(String(db.updates[1]?.sql), /current_period_end/);
    assert.doesNotMatch(String(db.updates[1]?.sql), /status = 'active'/);
    assert.equal(db.updates[1]?.args[0], 'RENEW-99-AA');
    assert.equal(db.updates[1]?.args[2], 'sub-1');
  });

  it('does not increment renewed when charged claim updates 0 rows', async () => {
    const due = [
      {
        id: 'sub-race',
        user_id: 'user-1',
        plan_type: 'monthly',
        provider_subscription_id: 'INIT-RACE',
        email: 'a@example.com',
      },
    ];
    const db = makeDb({ due, chargedChanges: 0 });
    const result = await renewDueComgateSubscriptions(db, {
      createSubscription: async () => ({ lastPaymentId: 'RENEW-RACE' }),
    });
    assert.equal(result.attempted, 1);
    assert.equal(result.renewed, 0);
    assert.ok(
      db.updates.some(
        (u) =>
          String(u.sql).includes("renewal_attempt_status = 'charged'") &&
          String(u.sql).includes("AND renewal_attempt_status = 'pending'"),
      ),
    );
  });

  it('continues later rows when one renewal throws', async () => {
    const due = [
      {
        id: 'sub-fail',
        user_id: 'user-1',
        plan_type: 'monthly',
        provider_subscription_id: 'INIT-1',
        email: 'a@example.com',
      },
      {
        id: 'sub-ok',
        user_id: 'user-2',
        plan_type: 'yearly',
        provider_subscription_id: 'INIT-2',
        email: 'b@example.com',
      },
    ];
    const db = makeDb({ due });
    const result = await renewDueComgateSubscriptions(db, {
      createSubscription: async (input) => {
        if (input.initRecurringId === 'INIT-1') {
          throw new Error('provider down');
        }
        return { lastPaymentId: 'RENEW-OK' };
      },
    });
    assert.equal(result.attempted, 2);
    assert.equal(result.renewed, 1);
    assert.ok(db.updates.some((u) => String(u.sql).includes("renewal_attempt_status = 'failed'")));
    assert.ok(db.updates.some((u) => String(u.sql).includes("renewal_attempt_status = 'charged'")));
  });

  it('leaves pending on timeout / renewal_failed and marks failed only on definitive declines', async () => {
    assert.equal(
      isAmbiguousComgateChargeError(Object.assign(new Error('timeout'), { code: 'comgate_timeout' })),
      true,
    );
    assert.equal(
      isAmbiguousComgateChargeError(
        Object.assign(new Error('no id'), { code: 'comgate_renewal_failed' }),
      ),
      true,
    );
    assert.equal(
      isAmbiguousComgateChargeError(
        Object.assign(new Error('api'), { code: 'comgate_api_error' }),
      ),
      false,
    );

    const due = [
      {
        id: 'sub-timeout',
        user_id: 'user-1',
        plan_type: 'monthly',
        provider_subscription_id: 'INIT-T',
        email: 'a@example.com',
      },
    ];
    const db = makeDb({ due });
    const result = await renewDueComgateSubscriptions(db, {
      createSubscription: async () => {
        throw Object.assign(new Error('Comgate request timed out'), { code: 'comgate_timeout' });
      },
    });
    assert.equal(result.renewed, 0);
    assert.ok(db.updates.some((u) => String(u.sql).includes("renewal_attempt_status = 'pending'")));
    assert.ok(!db.updates.some((u) => String(u.sql).includes("renewal_attempt_status = 'failed'")));
  });

  it('reconciles stale charged attempts via /v1.0/status before new charges', async () => {
    const stale = [
      {
        id: 'sub-stale',
        plan_type: 'monthly',
        renewal_attempt_payment_id: 'RENEW-OLD',
      },
    ];
    const due = [
      {
        id: 'sub-new',
        user_id: 'user-2',
        plan_type: 'yearly',
        provider_subscription_id: 'INIT-2',
        email: 'b@example.com',
      },
    ];
    const db = makeDb({ due, stale });
    const statusCalls: string[] = [];
    const result = await renewDueComgateSubscriptions(db, {
      createSubscription: async () => ({ lastPaymentId: 'RENEW-NEW' }),
      getPaymentStatus: async (transId) => {
        statusCalls.push(transId);
        return { status: 'PAID' };
      },
    });
    assert.deepEqual(statusCalls, ['RENEW-OLD']);
    assert.ok(db.updates.some((u) => String(u.sql).includes("renewal_attempt_status = 'completed'")));
    assert.ok(db.updates.some((u) => String(u.sql).includes('current_period_end')));
    assert.equal(result.renewed, 1);
  });

  it('does not reconcile pending attempts that lack renewal_attempt_payment_id', async () => {
    const stale = [
      {
        id: 'sub-no-id',
        plan_type: 'monthly',
        renewal_attempt_payment_id: '',
        last_provider_payment_id: 'OLD-SHOULD-NOT-USE',
      },
    ];
    const due: Array<Record<string, unknown>> = [];
    const db = makeDb({ due, stale });
    const statusCalls: string[] = [];
    await renewDueComgateSubscriptions(db, {
      createSubscription: async () => ({ lastPaymentId: 'X' }),
      getPaymentStatus: async (transId) => {
        statusCalls.push(transId);
        return { status: 'PAID' };
      },
    });
    // Empty renewal_attempt_payment_id is filtered in SQL; last_provider_payment_id is ignored.
    assert.deepEqual(statusCalls, []);
  });
});

describe('periodEndIsoForPlan', () => {
  it('preserves day of month and caps overflow (e.g. Jan 31 + 1 month)', () => {
    const from = new Date('2026-01-31T12:00:00.000Z');
    assert.match(periodEndIsoForPlan('monthly', from), /^2026-02-28T/);
    assert.match(periodEndIsoForPlan('yearly', from), /^2027-01-31T/);
    assert.match(periodEndIsoForPlan('club', from), /^2027-01-31T/);
  });
});
