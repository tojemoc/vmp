/**
 * Idempotent D1 schema the current API Worker requires (no .sql imports — testable under Node).
 */

import { log } from './logger.js';

type D1EnsureDb = Pick<D1Database, 'prepare' | 'exec'>;

export type EnsureD1RequiredSchemaSql = {
  step10Tables: string;
  clubEntitlements: string;
};

async function usersDeletionPendingColumnExists(db: D1EnsureDb): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = ?")
    .bind('deletion_pending')
    .first<{ n: number }>();
  return Number(row?.n ?? 0) === 1;
}

export async function ensureD1RequiredSchemaCore(
  db: D1EnsureDb,
  sql: EnsureD1RequiredSchemaSql,
): Promise<void> {
  if (!(await usersDeletionPendingColumnExists(db))) {
    log({
      service: 'd1',
      event: 'ensure_schema_add_deletion_pending',
      level: 'info',
    });
    await db.exec(
      'ALTER TABLE users ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0;',
    );
  }

  await db.exec(sql.step10Tables);
  await db.exec(sql.clubEntitlements);

  log({
    service: 'd1',
    event: 'ensure_schema_complete',
    level: 'info',
  });
}
