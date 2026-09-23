-- Club entitlements: IRL event invites/RSVP + global ads_enabled flag for ad-free gating.
-- Ad insertion itself is not implemented yet; ads_enabled defaults off so the gate is inert
-- until a player ad path exists. Club + staff still resolve as ad-free when the flag is on.

CREATE TABLE irl_events (
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

CREATE INDEX idx_irl_events_starts_at ON irl_events(starts_at);
CREATE INDEX idx_irl_events_published_starts ON irl_events(published, starts_at);

CREATE TABLE irl_event_rsvps (
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

CREATE INDEX idx_irl_event_rsvps_event ON irl_event_rsvps(event_id);
CREATE INDEX idx_irl_event_rsvps_user ON irl_event_rsvps(user_id);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('ads_enabled', '0', CURRENT_TIMESTAMP);
