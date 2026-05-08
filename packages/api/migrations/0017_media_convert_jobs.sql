CREATE TABLE IF NOT EXISTS media_convert_jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  aws_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (
    status IN ('uploaded','queued','transcoding','packaging','uploading','completed','failed')
  ),
  input_bucket TEXT NOT NULL,
  input_key TEXT NOT NULL,
  output_bucket TEXT NOT NULL,
  output_prefix TEXT NOT NULL,
  renditions_json TEXT NOT NULL DEFAULT '[]',
  input_duration_seconds INTEGER NOT NULL DEFAULT 0,
  normalized_minutes_est REAL NOT NULL DEFAULT 0,
  cost_est_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  last_polled_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_convert_jobs_video_created
  ON media_convert_jobs(video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_convert_jobs_status
  ON media_convert_jobs(status);
