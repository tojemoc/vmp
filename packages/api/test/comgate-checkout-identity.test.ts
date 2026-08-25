import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveComgateCheckoutIdentity } from '../src/paymentProcessor.js';

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
