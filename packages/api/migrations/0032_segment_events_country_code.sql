-- IP geolocation country (Cloudflare CF-IPCountry) at segment request time.
ALTER TABLE video_segment_events ADD COLUMN country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_video_segment_events_country_created
  ON video_segment_events(country_code, created_at);
