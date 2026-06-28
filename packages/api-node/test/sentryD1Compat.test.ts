import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { instrumentD1WithSentry } from '@sentry/cloudflare'
import { PostgresD1Adapter } from '../src/bindings/db.js'

describe('PostgresD1Adapter Sentry D1 instrumentation', () => {
  it('does not throw when Sentry instruments prepare/bind (missing .raw caused proxy errors)', () => {
    const db = new PostgresD1Adapter({
      databaseUrl: 'postgres://unused:5432/unused',
      enableWriteLog: false,
    })

    assert.doesNotThrow(() => {
      const instrumented = instrumentD1WithSentry(db as unknown as import('@cloudflare/workers-types').D1Database)
      const statement = instrumented.prepare('SELECT 1 AS n')
      assert.equal(typeof statement.bind, 'function')
      assert.equal(typeof statement.first, 'function')
      assert.equal(typeof statement.all, 'function')
      assert.equal(typeof statement.run, 'function')
      assert.equal(typeof statement.raw, 'function')
      const bound = statement.bind(1)
      assert.equal(typeof bound.first, 'function')
      assert.equal(typeof bound.raw, 'function')
    })
  })
})
