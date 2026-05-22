-- Support multiple transcoding providers (AWS MediaConvert, Bunny.net Stream).
ALTER TABLE media_convert_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'mediaconvert';
ALTER TABLE media_convert_jobs ADD COLUMN bunny_playback_url TEXT;
ALTER TABLE media_convert_jobs ADD COLUMN bunny_guid TEXT;

CREATE INDEX IF NOT EXISTS idx_media_convert_jobs_provider_status
  ON media_convert_jobs(provider, status);
