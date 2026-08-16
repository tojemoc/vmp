-- Document signed-in playback-position storage in the personal-data CMS page (#488).
-- Matches cmsPersonalDataSeedContent.ts / locales/en/personalData.ts.

UPDATE cms_pages
SET content = REPLACE(
  content,
  'These logs are not used to advertise to you and are not shared with ad networks."}]}',
  'These logs are not used to advertise to you and are not shared with ad networks."}]},{"type":"paragraph","content":[{"type":"text","text":"If you are signed in, we also store your last playback position per video on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume."}]}'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND content LIKE '%These logs are not used to advertise to you and are not shared with ad networks.%'
  AND content NOT LIKE '%last playback position per video%';
