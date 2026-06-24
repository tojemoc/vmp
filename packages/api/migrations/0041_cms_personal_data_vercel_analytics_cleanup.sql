-- Align persisted personal-data CMS seed with cmsPersonalDataSeedContent.ts
-- (0038 still contained the removed Vercel Web Analytics sentence from pre-#384).
UPDATE cms_pages
SET content = REPLACE(
  content,
  'Backup infrastructure may run on Deno Deploy (API) and Vercel (frontend). The Vercel deployment may load Vercel Web Analytics for operational traffic statistics on that hostname only.',
  'Backup infrastructure may run on Deno Deploy (API) and Vercel (frontend).'
)
WHERE id = 'cms-page-personal-data'
  AND content LIKE '%Vercel Web Analytics%';
