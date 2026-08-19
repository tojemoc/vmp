-- Document signed-in VOD playback-position storage in the personal-data CMS page (#488).
-- Idempotent: marker substring + REPLACE for standard seed + JSON append fallback for edited pages.
-- Uses instr() instead of LIKE on large JSON blobs (SQLite "pattern too complex" guard).

-- Upgrade rows that already received the first (generic) disclosure without the VOD qualifier.
UPDATE cms_pages
SET content = REPLACE(
  content,
  'If you are signed in, we also store your last playback position per video on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume.',
  'If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. You can remove a saved position for any video from Continue watching on your account page. If you request account deletion through the support channel published on this site, your saved positions are removed as part of that process.'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND instr(content, 'on-demand video (VOD)') = 0
  AND instr(content, 'last playback position per video') > 0;

-- Upgrade rows that already have VOD disclosure but not the Continue watching / per-video delete note.
UPDATE cms_pages
SET content = REPLACE(
  content,
  'If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. All saved positions are removed when your account is deleted.',
  'If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. You can remove a saved position for any video from Continue watching on your account page. If you request account deletion through the support channel published on this site, your saved positions are removed as part of that process.'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND instr(content, 'Continue watching on your account page') = 0
  AND instr(content, 'on-demand video (VOD)') > 0
  AND instr(content, 'All saved positions are removed when your account is deleted') > 0;

-- Standard installs: insert disclosure into the server-processing rich_text block.
UPDATE cms_pages
SET content = REPLACE(
  content,
  'These logs are not used to advertise to you and are not shared with ad networks."}]}',
  'These logs are not used to advertise to you and are not shared with ad networks."}]},{"type":"paragraph","content":[{"type":"text","text":"If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. You can remove a saved position for any video from Continue watching on your account page. If you request account deletion through the support channel published on this site, your saved positions are removed as part of that process."}]}'
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND instr(content, 'on-demand video (VOD)') = 0
  AND instr(content, 'These logs are not used to advertise to you and are not shared with ad networks') > 0;

-- Edited/restructured pages: append a standalone disclosure block when still missing.
-- This block uses SQLite-only JSON functions (json_insert, json_valid, json_type, json).
-- Postgres (api-node): equivalent jsonb append via -- POSTGRES line below; SQLite block
-- remains for D1 and is stripped by sqlDialect.ts during Postgres translation.
-- POSTGRES: UPDATE cms_pages SET content = (content::jsonb || '[{"type":"rich_text","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. You can remove a saved position for any video from Continue watching on your account page. If you request account deletion through the support channel published on this site, your saved positions are removed as part of that process."}]}]}}]'::jsonb)::text, updated_at = CURRENT_TIMESTAMP WHERE id = 'cms-page-personal-data' AND position('on-demand video (VOD)' in content) = 0 AND jsonb_typeof(content::jsonb) = 'array';
UPDATE cms_pages
SET content = json_insert(
  content,
  '$[#]',
  json('{"type":"rich_text","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"If you are signed in, we also store your last playback position per on-demand video (VOD) on our servers so we can resume where you left off. Positions are updated occasionally while you watch and when you leave the page — not on every scrub of the timeline. Anonymous visitors do not get server-side resume. You can remove a saved position for any video from Continue watching on your account page. If you request account deletion through the support channel published on this site, your saved positions are removed as part of that process."}]}]}}')
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 'cms-page-personal-data'
  AND json_valid(content) = 1
  AND json_type(content) = 'array'
  AND instr(content, 'on-demand video (VOD)') = 0;
