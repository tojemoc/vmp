-- Per-user last playback position for VOD resume (#488).
-- Auth-gated writes only; anonymous resume is out of scope.

CREATE TABLE playback_positions (
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  position_seconds REAL NOT NULL,
  client_captured_at_ms INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, video_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX idx_playback_positions_user_updated
  ON playback_positions(user_id, updated_at);
