import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  d1FirstOptionalColumn,
  isMissingD1ColumnError,
  isMissingD1TableError,
  resetD1OptionalColumnCache,
} from '../src/d1OptionalColumn.js';

afterEach(() => {
  resetD1OptionalColumnCache();
});

describe('isMissingD1ColumnError', () => {
  it('matches the production D1 SQLITE_ERROR signature', () => {
    const err = new Error(
      'D1_ERROR: no such column: u.deletion_pending at offset 110: SQLITE_ERROR',
    );
    assert.equal(isMissingD1ColumnError(err, 'deletion_pending'), true);
    assert.equal(isMissingD1ColumnError(err, 'totp_secret'), false);
  });

  it('ignores unrelated D1 errors', () => {
    assert.equal(
      isMissingD1ColumnError(new Error('D1_ERROR: no such table: users'), 'deletion_pending'),
      false,
    );
  });
});

describe('isMissingD1TableError', () => {
  it('matches the production D1 SQLITE_ERROR signature for irl_events', () => {
    const err = new Error('D1_ERROR: no such table: irl_events: SQLITE_ERROR');
    assert.equal(isMissingD1TableError(err, 'irl_events'), true);
    assert.equal(isMissingD1TableError(err, 'irl_event_rsvps'), false);
  });

  it('does not treat irl_event_rsvps as irl_events', () => {
    const err = new Error('D1_ERROR: no such table: irl_event_rsvps: SQLITE_ERROR');
    assert.equal(isMissingD1TableError(err, 'irl_event_rsvps'), true);
    assert.equal(isMissingD1TableError(err, 'irl_events'), false);
  });
});

describe('d1FirstOptionalColumn', () => {
  it('returns the primary query when the column exists', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return {
              async first() {
                if (sql.includes('deletion_pending')) return { id: 'u1', deletion_pending: 1 };
                throw new Error(`unexpected fallback sql: ${sql}`);
              },
            };
          },
        };
      },
    };
    const row = await d1FirstOptionalColumn(db, {
      column: 'deletion_pending',
      sql: 'SELECT id, deletion_pending FROM users WHERE id = ?',
      fallbackSql: 'SELECT id FROM users WHERE id = ?',
      binds: ['u1'],
      fallbackValue: 0,
    });
    assert.deepEqual(row, { id: 'u1', deletion_pending: 1 });
  });

  it('retries without the column and fills the fallback value', async () => {
    const sqls: string[] = [];
    const db = {
      prepare(sql: string) {
        sqls.push(sql);
        return {
          bind(..._args: unknown[]) {
            return {
              async first() {
                if (sql.includes('deletion_pending')) {
                  throw new Error(
                    'D1_ERROR: no such column: u.deletion_pending at offset 110: SQLITE_ERROR',
                  );
                }
                return { id: 'u1' };
              },
            };
          },
        };
      },
    };
    const row = await d1FirstOptionalColumn(db, {
      column: 'deletion_pending',
      sql: 'SELECT id, deletion_pending FROM users WHERE id = ?',
      fallbackSql: 'SELECT id FROM users WHERE id = ?',
      binds: ['u1'],
      fallbackValue: 0,
    });
    assert.deepEqual(row, { id: 'u1', deletion_pending: 0 });
    assert.equal(sqls.length, 2);

    const row2 = await d1FirstOptionalColumn(db, {
      column: 'deletion_pending',
      sql: 'SELECT id, deletion_pending FROM users WHERE id = ?',
      fallbackSql: 'SELECT id FROM users WHERE id = ?',
      binds: ['u1'],
      fallbackValue: 0,
    });
    assert.deepEqual(row2, { id: 'u1', deletion_pending: 0 });
    assert.equal(sqls.length, 3, 'cached missing column skips the failing SELECT');
  });
});
