import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bindQuestionMarks, translateSqliteToPostgres } from '../src/bindings/sqlDialect.js'

describe('translateSqliteToPostgres datetime', () => {
  it('translates datetime(?) for replication cursors', () => {
    const sql = `WHERE (? = '' OR datetime(created_at) > datetime(?) OR (datetime(created_at) = datetime(?) AND id > ?))`
    const out = translateSqliteToPostgres(sql)
    assert.match(out, /\(\?::timestamptz\)/)
    assert.doesNotMatch(out, /datetime\s*\(/i)
  })

  it('translates auth handoff expiry check', () => {
    const sql = `WHERE code = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`
    const out = translateSqliteToPostgres(sql)
    assert.match(out, /\(expires_at::timestamptz\)\s*>\s*CURRENT_TIMESTAMP/i)
    assert.doesNotMatch(out, /datetime\s*\(/i)
  })

  it('binds placeholders after translation', () => {
    const sql = translateSqliteToPostgres(`datetime(expires_at) > datetime('now') AND id = ?`)
    const bound = bindQuestionMarks(sql, 1)
    assert.match(bound, /\$1/)
    assert.doesNotMatch(bound, /datetime\s*\(/i)
  })
})

describe('translateSqliteToPostgres rowid', () => {
  it('maps SQLite rowid to Postgres ctid for dedup migrations', () => {
    const sql = `UPDATE subscriptions SET purchase_id = NULL
WHERE purchase_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM subscriptions WHERE purchase_id IS NOT NULL GROUP BY purchase_id
  )`
    const out = translateSqliteToPostgres(sql)
    assert.match(out, /\bctid\b/)
    assert.doesNotMatch(out, /\browid\b/i)
    assert.match(out, /MIN\(ctid\)/i)
  })
})
