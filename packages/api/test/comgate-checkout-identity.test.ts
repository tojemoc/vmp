import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
  function makeDb(due: Array<Record<string, unknown>>) {
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
            return { results: due };
          },
          async run() {
            updates.push({ sql: stmt.sql, args: stmt.args });
            return { meta: { changes: 1 }, changes: 1 };
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
    const db = makeDb(due);
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
    assert.doesNotMatch(String(db.updates[1]?.sql), /current_period_end/);
    assert.doesNotMatch(String(db.updates[1]?.sql), /status = 'active'/);
    assert.equal(db.updates[1]?.args[0], 'RENEW-99-AA');
    assert.equal(db.updates[1]?.args[2], 'sub-1');
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
    const db = makeDb(due);
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
});
