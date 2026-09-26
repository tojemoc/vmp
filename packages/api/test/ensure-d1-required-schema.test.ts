import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ensureD1RequiredSchemaCore } from '../src/ensureD1RequiredSchemaCore.js';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '../scripts');
const ensureSql = {
  step10Tables: readFileSync(join(scriptsDir, 'ensure_d1_step10_tables.sql'), 'utf8'),
  clubEntitlements: readFileSync(join(scriptsDir, 'ensure_d1_club_entitlements.sql'), 'utf8'),
};

describe('ensureD1RequiredSchemaCore', () => {
  it('adds deletion_pending when missing then runs bundled SQL', async () => {
    const execCalls: string[] = [];
    let deletionPendingPresent = false;

    const db = {
      prepare(sql: string) {
        return {
          bind: (..._args: unknown[]) => ({
            async first() {
              if (sql.includes('pragma_table_info')) {
                return { n: deletionPendingPresent ? 1 : 0 };
              }
              return null;
            },
          }),
        };
      },
      async exec(sql: string) {
        execCalls.push(sql);
        if (sql.includes('deletion_pending')) {
          deletionPendingPresent = true;
        }
      },
    };

    await ensureD1RequiredSchemaCore(db as never, ensureSql);

    assert.ok(
      execCalls.some((s) => s.includes('ALTER TABLE users ADD COLUMN deletion_pending')),
    );
    assert.ok(execCalls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS account_deletion_jobs')));
    assert.ok(execCalls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS irl_events')));
  });

  it('skips ALTER when deletion_pending already exists', async () => {
    const execCalls: string[] = [];

    const db = {
      prepare(sql: string) {
        return {
          bind: (..._args: unknown[]) => ({
            async first() {
              if (sql.includes('pragma_table_info')) {
                return { n: 1 };
              }
              return null;
            },
          }),
        };
      },
      async exec(sql: string) {
        execCalls.push(sql);
      },
    };

    await ensureD1RequiredSchemaCore(db as never, ensureSql);

    assert.ok(!execCalls.some((s) => s.startsWith('ALTER TABLE users')));
    assert.equal(execCalls.length, 2);
  });
});
