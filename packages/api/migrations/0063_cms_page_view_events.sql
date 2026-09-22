-- First-party CMS page view analytics (#643 / analytics-observability-cms).
-- Mirrors video_segment_events / video_view_counts patterns without a third-party SDK.

CREATE TABLE IF NOT EXISTS cms_page_view_events (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  page_slug TEXT NOT NULL,
  user_id TEXT,
  session_key TEXT NOT NULL,
  path TEXT NOT NULL,
  referer TEXT,
  source_host TEXT,
  source_category TEXT,
  source_detail TEXT,
  campaign_source TEXT,
  campaign_medium TEXT,
  country_code TEXT,
  ip_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES cms_pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cms_page_view_events_page_created
  ON cms_page_view_events(page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cms_page_view_events_created
  ON cms_page_view_events(created_at);
CREATE INDEX IF NOT EXISTS idx_cms_page_view_events_session_created
  ON cms_page_view_events(session_key, created_at);
CREATE INDEX IF NOT EXISTS idx_cms_page_view_events_source_created
  ON cms_page_view_events(source_category, created_at);
CREATE INDEX IF NOT EXISTS idx_cms_page_view_events_country_created
  ON cms_page_view_events(country_code, created_at);

CREATE TABLE IF NOT EXISTS cms_page_view_count_sessions (
  page_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (page_id, session_id),
  FOREIGN KEY (page_id) REFERENCES cms_pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cms_page_view_counts (
  page_id TEXT PRIMARY KEY,
  view_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES cms_pages(id) ON DELETE CASCADE
);
