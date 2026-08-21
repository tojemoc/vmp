import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleSiteSettings } from '../src/siteSettings.js';

class FakeDb {
  settings: Map<string, string>;
  queryLog: string[];

  constructor(settings: Record<string, string> = {}) {
    this.settings = new Map(Object.entries(settings));
    this.queryLog = [];
  }

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        return {
          async first() {
            db.queryLog.push(sql);
            if (sql.includes('SELECT value FROM admin_settings WHERE key = ?')) {
              const key = String(args[0]);
              const value = db.settings.get(key);
              return value == null ? null : { value };
            }
            return null;
          },
          async all() {
            db.queryLog.push(sql);
            if (sql.includes('SELECT key, value FROM admin_settings WHERE key IN')) {
              const keys = args.map(String);
              return {
                results: keys
                  .filter((key) => db.settings.has(key))
                  .map((key) => ({ key, value: db.settings.get(key) })),
              };
            }
            return { results: [] };
          },
        };
      },
    };
  }
}

describe('handleSiteSettings GET', () => {
  it('loads site settings with a batched admin_settings query', async () => {
    const db = new FakeDb({
      site_name: 'VMP',
      gtm_enabled: '1',
      settings_changed_at: '123',
    });
    const env = { DB: db };
    const request = new Request('https://example.com/api/site-settings', { method: 'GET' });

    const response = await handleSiteSettings(request, env, {});
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.site_name, 'VMP');
    assert.equal(body.gtm_enabled, '1');
    assert.equal(body.site_support_email, '');

    const adminSettingsQueries = db.queryLog.filter((sql) => sql.includes('admin_settings'));
    const batchedQueries = adminSettingsQueries.filter((sql) => sql.includes('key IN'));
    assert.equal(batchedQueries.length, 1);
    assert.ok(adminSettingsQueries.length <= 2);
  });
});
