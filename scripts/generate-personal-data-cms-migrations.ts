import fs from 'node:fs';
import {
  buildPersonalDataCmsBlocks,
  getPersonalDataCmsPageMeta,
  type PersonalDataCmsLocale,
} from '../packages/api/src/cmsPersonalDataSeedContent.ts';

function esc(s: string) {
  return s.replace(/'/g, "''");
}

function writeLocaleMigration(
  num: string,
  locale: PersonalDataCmsLocale,
  opts: { bootstrapFromSupportEmail?: boolean },
) {
  const meta = getPersonalDataCmsPageMeta(locale);
  const content = JSON.stringify(buildPersonalDataCmsBlocks(locale));
  const emailBootstrap = opts.bootstrapFromSupportEmail
    ? `
-- Bootstrap ui_locale for the SK instance when the exact ops support email is set.
INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
SELECT 'ui_locale', 'sk', CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM admin_settings
  WHERE key = 'site_support_email'
    AND LOWER(TRIM(value)) = 'vmp@tjm.sk'
);
`
    : '';

  const emailGuard = opts.bootstrapFromSupportEmail
    ? `
    OR EXISTS (
      SELECT 1 FROM admin_settings
      WHERE key = 'site_support_email'
        AND LOWER(TRIM(value)) = 'vmp@tjm.sk'
    )`
    : '';

  const sql = `-- Rewrite personal-data CMS page to short ${locale.toUpperCase()} notice.
-- Regenerated from packages/api/src/cmsPersonalDataSeedContent.ts (${locale}).
--
-- Locale guard (one language per D1 / deployment — see docs/i18n-prep.md):
-- Applies only when admin_settings.ui_locale = '${locale}'${
    opts.bootstrapFromSupportEmail
      ? ', or when site_support_email is exactly vmp@tjm.sk (SK monorepo ops).'
      : '.'
  }
-- Other locales leave this page unchanged. Safe to ship all three migrations together.
${emailBootstrap}
UPDATE cms_pages
SET title = '${esc(meta.title)}',
    description = '${esc(meta.description)}',
    content = '${esc(content)}',
    updated_at = CURRENT_TIMESTAMP
WHERE id = '${meta.id}'
  AND (
    EXISTS (
      SELECT 1 FROM admin_settings
      WHERE key = 'ui_locale' AND TRIM(value) = '${locale}'
    )${emailGuard}
  );
`;

  const path = new URL(
    `../packages/api/migrations/${num}_cms_personal_data_${locale}_short_notice.sql`,
    import.meta.url,
  );
  fs.writeFileSync(path, sql);
  console.log('wrote', path.pathname, sql.length);
}

writeLocaleMigration('0053', 'sk', { bootstrapFromSupportEmail: true });
writeLocaleMigration('0054', 'en', { bootstrapFromSupportEmail: false });
writeLocaleMigration('0055', 'cs', { bootstrapFromSupportEmail: false });
