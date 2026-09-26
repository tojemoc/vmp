/**
 * Idempotent D1 schema the current API Worker requires (no .sql imports — testable under Node).
 */

import { log } from './logger.js';

type D1EnsureDb = Pick<D1Database, 'prepare' | 'exec'>;

export type EnsureD1RequiredSchemaSql = {
  step10Tables: string;
  clubEntitlements: string;
};

async function tableColumnExists(db: D1EnsureDb, table: string, column: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`)
    .bind(column)
    .first<{ n: number }>();
  return Number(row?.n ?? 0) === 1;
}

export async function ensureD1RequiredSchemaCore(
  db: D1EnsureDb,
  sql: EnsureD1RequiredSchemaSql,
): Promise<void> {
  if (!(await tableColumnExists(db, 'users', 'deletion_pending'))) {
    log({
      service: 'd1',
      event: 'ensure_schema_add_deletion_pending',
      level: 'info',
    });
    await db.exec('ALTER TABLE users ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0;');
  }

  if (!(await tableColumnExists(db, 'magic_link_tokens', 'otp_hash'))) {
    log({
      service: 'd1',
      event: 'ensure_schema_add_magic_link_otp_hash',
      level: 'info',
    });
    await db.exec('ALTER TABLE magic_link_tokens ADD COLUMN otp_hash TEXT;');
  }

  try {
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_magic_link_otp_hash ON magic_link_tokens(otp_hash) WHERE otp_hash IS NOT NULL;',
    );
  } catch (err) {
    // Index is best-effort; column presence is what unblocks OTP email sends.
    log({
      service: 'd1',
      event: 'ensure_schema_otp_hash_index_skipped',
      level: 'warn',
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  await db.exec(sql.step10Tables);
  await db.exec(sql.clubEntitlements);

  log({
    service: 'd1',
    event: 'ensure_schema_complete',
    level: 'info',
  });
}
