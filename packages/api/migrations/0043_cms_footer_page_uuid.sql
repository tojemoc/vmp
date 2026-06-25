-- Migrate footer system page to UUID id so /api/pages/:uuid routes work.
UPDATE cms_pages
SET id = 'f0000001-0000-4000-8000-000000000001'
WHERE id = 'cms-page-footer';

UPDATE cms_page_revisions
SET page_id = 'f0000001-0000-4000-8000-000000000001'
WHERE page_id = 'cms-page-footer';
