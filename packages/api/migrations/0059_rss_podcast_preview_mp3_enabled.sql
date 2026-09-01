-- Tenant toggle for podcast preview MP3 prerender (child of rss_free_preview_enabled / RSS feeds).
INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
VALUES ('rss_podcast_preview_mp3_enabled', '1', CURRENT_TIMESTAMP);
