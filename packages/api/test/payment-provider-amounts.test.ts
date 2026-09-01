import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPaymentsConfig } from '../src/paymentProviders.js';
import { resetSettingsCacheForTests } from '../src/settingsStore.js';

class FakeDb {
  settings: Map<string, string>;

  constructor(settings: Record<string, string> = {}) {
    this.settings = new Map(Object.entries(settings));
  }

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        return {
          async first() {
            if (sql.includes('SELECT value FROM admin_settings WHERE key = ?')) {
              const key = String(args[0]);
              const value = db.settings.get(key);
              return value == null ? null : { value };
            }
            if (sql.includes('settings_changed_at')) {
              return { value: db.settings.get('settings_changed_at') ?? '1' };
            }
            return null;
          },
        };
      },
    };
  }
}

function buildEnv(settings: Record<string, string>) {
  return {
    DB: new FakeDb({ settings_changed_at: '1', ...settings }),
    GOPAY_CLIENT_ID: 'id',
    GOPAY_CLIENT_SECRET: 'secret',
    GOPAY_GOID: '123',
    API_URL: 'https://api.example.test',
    COMGATE_MERCHANT: 'merchant',
    COMGATE_SECRET: 'secret',
    FRONTEND_URL: 'https://app.example.test',
  };
}

describe('gateway amount fallbacks', () => {
  it('does not treat EUR plan prices as CZK when gateway currency is CZK', async () => {
    resetSettingsCacheForTests();
    const env = buildEnv({
      gopay_currency: 'CZK',
      monthly_price_eur: '6.90',
    });
    const config = buildPaymentsConfig(env);
    const amount = await config.gopay.amountMajorForPlan?.('monthly');
    assert.equal(amount, null);
  });

  it('falls back to EUR plan prices when gateway currency is EUR', async () => {
    resetSettingsCacheForTests();
    const env = buildEnv({
      comgate_currency: 'EUR',
      monthly_price_eur: '6.90',
    });
    const config = buildPaymentsConfig(env);
    const amount = await config.comgate.amountMajorForPlan?.('monthly');
    assert.equal(amount, 6.9);
  });
});
