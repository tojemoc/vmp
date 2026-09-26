import ensureD1ClubEntitlementsSql from '../scripts/ensure_d1_club_entitlements.sql';
import ensureD1Step10TablesSql from '../scripts/ensure_d1_step10_tables.sql';
import {
  ensureD1RequiredSchemaCore,
  type EnsureD1RequiredSchemaSql,
} from './ensureD1RequiredSchemaCore.js';

type D1EnsureDb = Pick<D1Database, 'prepare' | 'exec'>;

const defaultEnsureSql: EnsureD1RequiredSchemaSql = {
  step10Tables: ensureD1Step10TablesSql,
  clubEntitlements: ensureD1ClubEntitlementsSql,
};

/** Applied from the five-minute cron via the D1 binding (no D1 HTTP API token required). */
export async function ensureD1RequiredSchema(db: D1EnsureDb): Promise<void> {
  await ensureD1RequiredSchemaCore(db, defaultEnsureSql);
}
