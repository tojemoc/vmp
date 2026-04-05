-- Add vanity slug column to videos for custom /watch/<slug> URLs.
-- Slugs are optional (NULL = use the video ID in the URL).
-- The unique index uses a partial index (WHERE slug IS NOT NULL) so that
-- multiple rows can have NULL slugs without violating uniqueness.
ALTER TABLE videos ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_slug ON videos (slug) WHERE slug IS NOT NULL;
