import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCmsBlocks } from '../src/cmsBlockValidation.js';
import {
  buildPersonalDataCmsBlocks,
  getPersonalDataCmsPageMeta,
  PERSONAL_DATA_CMS_LOCALES,
  PERSONAL_DATA_CMS_PAGE,
  type PersonalDataCmsLocale,
} from '../src/cmsPersonalDataSeedContent.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const MIGRATION_BY_LOCALE: Record<PersonalDataCmsLocale, string> = {
  sk: '0053_cms_personal_data_sk_short_notice.sql',
  en: '0054_cms_personal_data_en_short_notice.sql',
  cs: '0055_cms_personal_data_cs_short_notice.sql',
};

function extractMigrationContentJson(sql: string): unknown {
  const match = sql.match(/\n\s*content = '((?:[^']|'')*)'/);
  assert.ok(match?.[1], "migration must contain a content = '...' assignment");
  const unescaped = match[1].replace(/''/g, "'");
  return JSON.parse(unescaped);
}

describe('personal-data CMS seed', () => {
  it('builds blocks that pass CMS validation for every locale', () => {
    for (const locale of PERSONAL_DATA_CMS_LOCALES) {
      const blocks = buildPersonalDataCmsBlocks(locale);
      const parsed = parseCmsBlocks(blocks);
      assert.ok(parsed, `locale ${locale} blocks must validate`);
      assert.equal(parsed.length, blocks.length);
      const table = parsed.find((block) => block.type === 'table');
      assert.ok(table && table.type === 'table');
      assert.equal(table.columnKeys.length, 3);
      assert.equal(table.rows.length, 7);
    }
  });

  it('defaults PERSONAL_DATA_CMS_PAGE metadata to English', () => {
    assert.equal(PERSONAL_DATA_CMS_PAGE.id, 'cms-page-personal-data');
    assert.equal(PERSONAL_DATA_CMS_PAGE.slug, 'personal-data');
    assert.equal(PERSONAL_DATA_CMS_PAGE.title, getPersonalDataCmsPageMeta('en').title);
  });

  it('keeps migration SQL content in sync with buildPersonalDataCmsBlocks()', () => {
    for (const locale of PERSONAL_DATA_CMS_LOCALES) {
      const file = path.join(migrationsDir, MIGRATION_BY_LOCALE[locale]);
      const sql = fs.readFileSync(file, 'utf8');
      assert.match(sql, new RegExp(`ui_locale.*= '${locale}'`));
      // Explicit ui_locale only — no email-based locale inference (Prelint).
      assert.doesNotMatch(sql, /site_support_email/);
      assert.match(sql, /no email-based bootstrap/i);
      assert.doesNotMatch(sql, /(?:^|\n)INSERT\b/);
      const fromSql = extractMigrationContentJson(sql);
      const fromTs = buildPersonalDataCmsBlocks(locale);
      assert.deepEqual(fromSql, fromTs, `migration drift for locale ${locale}`);
    }
  });
});
