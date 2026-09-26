import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensureD1RequiredSchemaCore } from '../src/ensureD1RequiredSchemaCore.js';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '../scripts');
const ensureSql = {
  step10Tables: readFileSync(join(scriptsDir, 'ensure_d1_step10_tables.sql'), 'utf8'),
  clubEntitlements: readFileSync(join(scriptsDir, 'ensure_d1_club_entitlements.sql'), 'utf8'),
};

describe('ensureD1RequiredSchemaCore', () => {
  it('adds deletion_pending and otp_hash when missing then runs bundled SQL', async () => {
    const execCalls: string[] = [];
    const present = new Set<string>();

    const db = {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes('pragma_table_info')) {
                const column = String(args[0] ?? '');
                const table = sql.includes('magic_link_tokens') ? 'magic_link_tokens' : 'users';
                return { n: present.has(`${table}.${column}`) ? 1 : 0 };
              }
              return null;
            },
          }),
        };
      },
      async exec(sql: string) {
        execCalls.push(sql);
        if (sql.includes('deletion_pending')) present.add('users.deletion_pending');
        if (sql.includes('otp_hash') && sql.includes('ALTER TABLE')) {
          present.add('magic_link_tokens.otp_hash');
        }
      },
    };

    await ensureD1RequiredSchemaCore(db as never, ensureSql);

    assert.ok(execCalls.some((s) => s.includes('ALTER TABLE users ADD COLUMN deletion_pending')));
    assert.ok(
      execCalls.some((s) => s.includes('ALTER TABLE magic_link_tokens ADD COLUMN otp_hash')),
    );
    assert.ok(execCalls.some((s) => s.includes('idx_magic_link_otp_hash')));
    assert.ok(
      execCalls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS account_deletion_jobs')),
    );
    assert.ok(execCalls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS irl_events')));
  });

  it('skips ALTER when required columns already exist', async () => {
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
    assert.ok(!execCalls.some((s) => s.startsWith('ALTER TABLE magic_link_tokens')));
    // index attempt + step10 + club
    assert.equal(execCalls.length, 3);
  });
});
