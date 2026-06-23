import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bindQuestionMarks,
  expandPostgresOnlyStatements,
  splitQuestionMarks,
  translateSqliteDdl,
  translateSqliteToPostgres,
} from '../src/bindings/sqlDialect.js'

describe('expandPostgresOnlyStatements', () => {
  it('expands POSTGRES comment hints into executable SQL', () => {
    const sql = `-- POSTGRES: ALTER TABLE promo_redemptions DROP CONSTRAINT IF EXISTS promo_redemptions_promo_code_id_fkey;
DROP TABLE promo_codes;`
    const out = expandPostgresOnlyStatements(sql)
    assert.match(out, /ALTER TABLE promo_redemptions DROP CONSTRAINT/)
    assert.match(out, /DROP TABLE promo_codes;/)
    assert.doesNotMatch(out, /--\s*POSTGRES:/i)
  })
})

describe('translateSqliteDdl migration 0039 cms_pages trigger', () => {
  it('strips SQLite trigger DDL and keeps POSTGRES replacement', () => {
    const sql = `CREATE TRIGGER IF NOT EXISTS cms_pages_set_updated_at
AFTER UPDATE ON cms_pages
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE cms_pages SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
-- POSTGRES: CREATE OR REPLACE FUNCTION cms_pages_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at = CURRENT_TIMESTAMP; END IF; RETURN NEW; END; $$;
-- POSTGRES: DROP TRIGGER IF EXISTS cms_pages_set_updated_at ON cms_pages;
-- POSTGRES: CREATE TRIGGER cms_pages_set_updated_at BEFORE UPDATE ON cms_pages FOR EACH ROW EXECUTE PROCEDURE cms_pages_touch_updated_at();`
    const out = translateSqliteDdl(sql)
    assert.doesNotMatch(out, /BEGIN\s+UPDATE cms_pages/i)
    assert.match(out, /CREATE OR REPLACE FUNCTION cms_pages_touch_updated_at/i)
    assert.match(out, /CREATE TRIGGER cms_pages_set_updated_at/i)
  })
})

describe('translateSqliteDdl migration 0036 promo_codes', () => {
  it('drops and recreates promo_redemptions FK around promo_codes table swap', () => {
    const sql = `PRAGMA foreign_keys = OFF;
INSERT INTO promo_codes__v2 SELECT id FROM promo_codes;
-- POSTGRES: ALTER TABLE promo_redemptions DROP CONSTRAINT IF EXISTS promo_redemptions_promo_code_id_fkey;
DROP TABLE promo_codes;
ALTER TABLE promo_codes__v2 RENAME TO promo_codes;
-- POSTGRES: ALTER TABLE promo_redemptions ADD CONSTRAINT promo_redemptions_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE;
PRAGMA foreign_keys = ON;`
    const out = translateSqliteDdl(sql)
    assert.match(out, /DROP CONSTRAINT IF EXISTS promo_redemptions_promo_code_id_fkey/i)
    assert.match(out, /ADD CONSTRAINT promo_redemptions_promo_code_id_fkey/i)
    assert.doesNotMatch(out, /PRAGMA/i)
  })
})

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
