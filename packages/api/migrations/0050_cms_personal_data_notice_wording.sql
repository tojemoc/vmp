-- Align personal-data CMS disclosure with accurate self-service + support wording (#488).
-- Idempotent REPLACE on known English seed / migration 0049 strings.
-- Uses instr() instead of LIKE on large JSON blobs (SQLite "pattern too complex" guard).

-- Tighten "any video" → "any currently available video" (list shows published videos only).
UPDATE cms_pages
SET content = REPLACE(
  content,
  'You can remove a saved position for any video from Continue watching on your account page.',
  'You can remove a saved position for any currently available video from Continue watching on your account page.'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND instr(content, 'any currently available video') = 0
  AND instr(content, 'You can remove a saved position for any video from Continue watching on your account page.') > 0;

-- Point account-deletion / erasure contact to the on-page support address (not a vague channel).
UPDATE cms_pages
SET content = REPLACE(
  content,
  'If you request account deletion through the support channel published on this site, your saved positions are removed as part of that process.',
  'If you request account deletion by emailing the support address shown at the bottom of this page, your saved positions are removed as part of that process.'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND instr(content, 'support address shown at the bottom of this page') = 0
  AND instr(content, 'support channel published on this site') > 0
  AND instr(content, 'If you request account deletion through the support channel published on this site') > 0;

UPDATE cms_pages
SET content = REPLACE(
  content,
  'To exercise rights, contact us using the support channel published on this site.',
  'To exercise rights, email the support address shown at the bottom of this page.'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND instr(content, 'email the support address shown at the bottom of this page') = 0
  AND instr(content, 'To exercise rights, contact us using the support channel published on this site.') > 0;
