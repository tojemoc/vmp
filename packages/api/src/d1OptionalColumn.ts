/**
 * D1 queries that need a column added by a migration which may not have been
 * applied yet (Worker deploys historically do not run `migrations/*.sql`).
 *
 * After the first "no such column" error in an isolate, later queries skip
 * the missing column and use a documented fallback value.
 */

import { log } from './logger.js';

const missingColumns = new Set<string>();

export function resetD1OptionalColumnCache(): void {
  missingColumns.clear();
}

export function isMissingD1ColumnError(err: unknown, column: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/no such column/i.test(msg)) return false;
  return msg.includes(column);
}

/** Match D1 `no such table: irl_events` without treating `irl_event_rsvps` as `irl_events`. */
export function isMissingD1TableError(err: unknown, table: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/no such table/i.test(msg)) return false;
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`no such table:\\s*${escaped}(?:\\s|:|$)`, 'i').test(msg);
}

type D1FirstDb = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => { first: () => Promise<Record<string, unknown> | null> };
  };
};

/** D1 `.first()` is untyped throughout @vmp/api; keep the same shape for callers. */
export async function d1FirstOptionalColumn(
  db: D1FirstDb,
  opts: {
    column: string;
    sql: string;
    fallbackSql: string;
    binds?: unknown[];
    fallbackValue?: unknown;
    logService?: string;
    logEvent?: string;
  },
): Promise<any> {
  const binds = opts.binds ?? [];
  const run = (sql: string) =>
    db
      .prepare(sql)
      .bind(...binds)
      .first();

  if (!missingColumns.has(opts.column)) {
    try {
      return await run(opts.sql);
    } catch (err) {
      if (!isMissingD1ColumnError(err, opts.column)) throw err;
      missingColumns.add(opts.column);
      log({
        service: opts.logService ?? 'd1',
        event: opts.logEvent ?? 'd1_missing_column_fallback',
        level: 'error',
        error_code: 'missing_column',
        error_message: opts.column,
      });
    }
  }

  const row = await run(opts.fallbackSql);
  if (row == null) return row;
  if (Object.hasOwn(row, opts.column)) return row;
  return { ...row, [opts.column]: opts.fallbackValue ?? 0 };
}
