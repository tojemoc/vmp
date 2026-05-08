ALTER TABLE videos ADD COLUMN legacy_slug TEXT;
CREATE UNIQUE INDEX idx_videos_legacy_slug ON videos(legacy_slug);
