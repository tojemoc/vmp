import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolvePromoCodeForCheckout } from '../src/promotions.js';
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
          async all() {
            return { results: [] };
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
      },
    };
  }
}

function buildEnv(settings: Record<string, string>) {
  return {
    DB: new FakeDb({ settings_changed_at: '1', ...settings }),
  };
}

describe('resolvePromoCodeForCheckout promotions gate', () => {
  it('treats empty promo as empty even when promotions are disabled', async () => {
    resetSettingsCacheForTests();
    const env = buildEnv({ promotions_enabled: '0' });
    const result = await resolvePromoCodeForCheckout(env, '', 'monthly', 'stripe');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty');
  });

  it('treats whitespace-only promo as empty when promotions are disabled', async () => {
    resetSettingsCacheForTests();
    const env = buildEnv({ promotions_enabled: '0' });
    const result = await resolvePromoCodeForCheckout(env, '   ', 'monthly', 'stripe');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty');
  });

  it('rejects a non-empty promo when promotions are disabled', async () => {
    resetSettingsCacheForTests();
    const env = buildEnv({ promotions_enabled: '0' });
    const result = await resolvePromoCodeForCheckout(env, 'STUDENT2026', 'monthly', 'stripe');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'promotions_disabled');
  });
});

describe('generateOtpCode', () => {
  it('returns a zero-padded 6-digit string', async () => {
    const { generateOtpCode } = await import('../src/auth.js');
    for (let i = 0; i < 20; i++) {
      const code = generateOtpCode();
      assert.match(code, /^\d{6}$/);
    }
  });
});
