-- Idempotent Club entitlement tables/indexes from 0059 + 0067 (no ALTER).
-- Safe to re-run on every deploy. Historical migrations/*.sql are not Wrangler
-- D1 migration history and are not applied by CD.

CREATE TABLE IF NOT EXISTS playback_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  video_id      TEXT NOT NULL,
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_user_active
  ON playback_sessions(user_id, last_seen_at);

CREATE TABLE IF NOT EXISTS irl_events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  starts_at    DATETIME NOT NULL,
  ends_at      DATETIME,
  capacity     INTEGER,
  club_only    INTEGER NOT NULL DEFAULT 1,
  published    INTEGER NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_irl_events_starts_at ON irl_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_irl_events_published_starts ON irl_events(published, starts_at);

CREATE TABLE IF NOT EXISTS irl_event_rsvps (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  check_in_token  TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'confirmed',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_in_at   DATETIME,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES irl_events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_irl_event_rsvps_event ON irl_event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_irl_event_rsvps_user ON irl_event_rsvps(user_id);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('ads_enabled', '0', CURRENT_TIMESTAMP),
  ('concurrent_playback_enforced', '0', CURRENT_TIMESTAMP),
  ('concurrent_playback_limit_default', '1', CURRENT_TIMESTAMP),
  ('concurrent_playback_limit_club', '3', CURRENT_TIMESTAMP),
  ('concurrent_playback_stale_seconds', '90', CURRENT_TIMESTAMP);
