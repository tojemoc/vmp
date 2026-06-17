import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bindQuestionMarks, splitQuestionMarks, translateSqliteToPostgres } from '../src/bindings/sqlDialect.js'

describe('splitQuestionMarks', () => {
  it('splits placeholders outside quoted strings', () => {
    const parts = splitQuestionMarks(`SELECT * FROM users WHERE id = ? AND email = ?`)
    assert.deepEqual(parts, ['SELECT * FROM users WHERE id = ', ' AND email = ', ''])
    assert.equal(bindQuestionMarks(parts.join('?'), 2), 'SELECT * FROM users WHERE id = $1 AND email = $2')
  })

  it('ignores question marks inside string literals', () => {
    const parts = splitQuestionMarks(`WHERE note = 'a?b' AND id = ?`)
    assert.deepEqual(parts, [`WHERE note = 'a?b' AND id = `, ''])
  })

  it('handles escaped single and double quote pairs without splitting on them', () => {
    const sql = `WHERE a = 'it''s' AND b = "w""z" AND c = ?`
    const parts = splitQuestionMarks(sql)
    assert.deepEqual(parts, [`WHERE a = 'it''s' AND b = "w""z" AND c = `, ''])
    assert.equal(bindQuestionMarks(parts.join('?'), 1), `WHERE a = 'it''s' AND b = "w""z" AND c = $1`)
  })

  it('ignores question marks inside double-quoted string literals', () => {
    const parts = splitQuestionMarks(`WHERE col = "a?b" AND id = ?`)
    assert.deepEqual(parts, [`WHERE col = "a?b" AND id = `, ''])
    assert.equal(bindQuestionMarks(parts.join('?'), 1), 'WHERE col = "a?b" AND id = $1')
  })
})

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
