-- Corrective backfill for environments where 0030 failed on orphan video_segment_events
-- (no FK to videos). Idempotent: safe when 0030 already backfilled successfully.

INSERT OR IGNORE INTO video_view_count_sessions (video_id, session_id)
SELECT
  vse.video_id,
  COALESCE(
    vse.session_key,
    CASE
      WHEN vse.user_id IS NOT NULL THEN 'u:' || vse.user_id
      WHEN vse.ip_hash IS NOT NULL THEN 'i:' || vse.ip_hash
      ELSE 'path:' || vse.request_path
    END
  )
FROM video_segment_events vse
INNER JOIN videos v ON v.id = vse.video_id
WHERE vse.event_type = 'segment'
  AND vse.video_id != 'unknown';

INSERT INTO video_view_counts (video_id, view_count, updated_at)
SELECT video_id, COUNT(*), CURRENT_TIMESTAMP
FROM video_view_count_sessions
GROUP BY video_id
ON CONFLICT(video_id) DO UPDATE SET
  view_count = excluded.view_count,
  updated_at = excluded.updated_at;
