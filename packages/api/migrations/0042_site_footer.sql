INSERT OR IGNORE INTO cms_pages (id, title, slug, description, status, content, published_at)
VALUES (
  'f0000001-0000-4000-8000-000000000001',
  'Site footer',
  '_footer',
  'Content shown in the site-wide footer.',
  'published',
  '[{"type":"rich_text","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Information and legal notices for visitors."}]}]}}]',
  CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
VALUES ('site_footer', '{"linkPageIds":[]}', CURRENT_TIMESTAMP);
