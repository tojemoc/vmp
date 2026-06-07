-- Precomputed per-video view counts (distinct playback sessions).
-- Incrementally maintained in logSegmentEvent (adminExtras.ts); backfilled below.

CREATE TABLE IF NOT EXISTS video_view_count_sessions (
  video_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (video_id, session_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_view_counts (
  video_id TEXT PRIMARY KEY,
  view_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO video_view_count_sessions (video_id, session_id)
SELECT
  video_id,
  COALESCE(
    session_key,
    CASE
      WHEN user_id IS NOT NULL THEN 'u:' || user_id
      WHEN ip_hash IS NOT NULL THEN 'i:' || ip_hash
      ELSE 'path:' || request_path
    END
  )
FROM video_segment_events
WHERE event_type = 'segment';

INSERT INTO video_view_counts (video_id, view_count, updated_at)
SELECT video_id, COUNT(*), CURRENT_TIMESTAMP
FROM video_view_count_sessions
GROUP BY video_id
ON CONFLICT(video_id) DO UPDATE SET
  view_count = excluded.view_count,
  updated_at = excluded.updated_at;
