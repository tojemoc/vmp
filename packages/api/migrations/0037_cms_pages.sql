CREATE TABLE IF NOT EXISTS cms_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  content TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_cms_pages_slug ON cms_pages(slug);
CREATE INDEX IF NOT EXISTS idx_cms_pages_status ON cms_pages(status);

CREATE TABLE IF NOT EXISTS cms_page_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  FOREIGN KEY (page_id) REFERENCES cms_pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cms_page_revisions_page_id ON cms_page_revisions(page_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cms_media (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  filename TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  content_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_cms_media_key ON cms_media(key);
