import fs from 'node:fs';
import {
  buildPersonalDataCmsBlocks,
  getPersonalDataCmsPageMeta,
  type PersonalDataCmsLocale,
} from '../packages/api/src/cmsPersonalDataSeedContent.ts';

function esc(s: string) {
  return s.replace(/'/g, "''");
}

function writeLocaleMigration(num: string, locale: PersonalDataCmsLocale) {
  const meta = getPersonalDataCmsPageMeta(locale);
  const content = JSON.stringify(buildPersonalDataCmsBlocks(locale));

  const sql = `-- Rewrite personal-data CMS page to short ${locale.toUpperCase()} notice.
-- Regenerated from packages/api/src/cmsPersonalDataSeedContent.ts (${locale}).
--
-- Locale guard (one language per D1 / deployment — see docs/i18n-prep.md):
-- Applies only when LOWER(TRIM(admin_settings.ui_locale)) = '${locale}'.
-- Operators must set that key explicitly before migrate (documented setup step;
-- no email-based bootstrap). Other locales leave this page unchanged.
-- Safe to ship all three migrations together.

UPDATE cms_pages
SET title = '${esc(meta.title)}',
    description = '${esc(meta.description)}',
    content = '${esc(content)}',
    updated_at = CURRENT_TIMESTAMP
WHERE id = '${meta.id}'
  AND EXISTS (
    SELECT 1 FROM admin_settings
    WHERE key = 'ui_locale' AND LOWER(TRIM(value)) = '${locale}'
  );
`;

  const path = new URL(
    `../packages/api/migrations/${num}_cms_personal_data_${locale}_short_notice.sql`,
    import.meta.url,
  );
  fs.writeFileSync(path, sql);
  console.log('wrote', path.pathname, sql.length);
}

writeLocaleMigration('0053', 'sk');
writeLocaleMigration('0054', 'en');
writeLocaleMigration('0055', 'cs');
