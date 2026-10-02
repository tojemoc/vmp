import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostgresD1Adapter } from '../src/bindings/db.js';

/**
 * Sentry Cloudflare SDK 10 exposed `instrumentD1WithSentry` which proxied D1
 * statement methods. SDK 11 instruments D1 automatically inside `withSentry()`
 * and no longer exports a manual wrapper. The adapter still must expose the
 * statement surface the proxy expects — especially `.raw`, whose absence caused
 * production failures when Sentry wrapped prepare/bind.
 */
describe('PostgresD1Adapter Sentry D1 instrumentation', () => {
  it('exposes prepare/bind statement methods Sentry D1 proxies expect (incl. .raw)', () => {
    const db = new PostgresD1Adapter({
      databaseUrl: 'postgres://unused:5432/unused',
      enableWriteLog: false,
    });

    assert.doesNotThrow(() => {
      const statement = db.prepare('SELECT 1 AS n');
      assert.equal(typeof statement.bind, 'function');
      assert.equal(typeof statement.first, 'function');
      assert.equal(typeof statement.all, 'function');
      assert.equal(typeof statement.run, 'function');
      assert.equal(typeof statement.raw, 'function');
      const bound = statement.bind(1);
      assert.equal(typeof bound.first, 'function');
      assert.equal(typeof bound.raw, 'function');
    });
  });
});
