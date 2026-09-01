-- Concurrent playback session tracking for club stream limits (#649).
-- Rows are created/refreshed by authenticated heartbeats and counted when
-- /api/video-access issues a stream. Ships disabled
-- (concurrent_playback_enforced = 0) for a safe, measurable rollout.

CREATE TABLE playback_sessions (
  id            TEXT PRIMARY KEY,        -- client-generated session UUID
  user_id       TEXT NOT NULL,
  video_id      TEXT NOT NULL,
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_playback_sessions_user_active
  ON playback_sessions(user_id, last_seen_at);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('concurrent_playback_enforced', '0', CURRENT_TIMESTAMP),
  ('concurrent_playback_limit_default', '1', CURRENT_TIMESTAMP),
  ('concurrent_playback_limit_club', '3', CURRENT_TIMESTAMP),
  ('concurrent_playback_stale_seconds', '90', CURRENT_TIMESTAMP);
