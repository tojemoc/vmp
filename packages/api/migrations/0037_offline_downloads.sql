-- Offline downloads: device registration + download licenses (M1/M2)

CREATE TABLE offline_devices (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  device_name        TEXT NOT NULL,
  public_key         TEXT,
  device_token_hash  TEXT NOT NULL,
  registered_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at       DATETIME,
  revoked_at         DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_offline_devices_user ON offline_devices(user_id);
CREATE UNIQUE INDEX idx_offline_devices_token_hash ON offline_devices(device_token_hash);

CREATE TABLE offline_download_licenses (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  video_id          TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  rendition         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  issued_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at        DATETIME NOT NULL,
  last_renewed_at   DATETIME,
  revoked_at        DATETIME,
  revoked_reason    TEXT,
  manifest_hash     TEXT NOT NULL,
  manifest_paths    TEXT NOT NULL,
  manifest_version  INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (video_id) REFERENCES videos(id),
  FOREIGN KEY (device_id) REFERENCES offline_devices(id),
  UNIQUE(user_id, video_id, rendition, device_id)
);

CREATE INDEX idx_odl_user ON offline_download_licenses(user_id);
CREATE INDEX idx_odl_device ON offline_download_licenses(device_id);
CREATE INDEX idx_odl_expires ON offline_download_licenses(expires_at);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('offline_max_license_days', '30', CURRENT_TIMESTAMP),
  ('offline_revalidation_days', '7', CURRENT_TIMESTAMP),
  ('offline_device_limit_default', '5', CURRENT_TIMESTAMP),
  ('offline_device_limit_club', '10', CURRENT_TIMESTAMP);
