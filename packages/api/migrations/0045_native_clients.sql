-- Native / TV client contracts (Phase 0): pairing sessions + APNs/FCM device tokens.
-- See docs/native-clients-plan.md.

CREATE TABLE IF NOT EXISTS device_pairing_sessions (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  device_name TEXT,
  device_platform TEXT,
  expires_at DATETIME NOT NULL,
  completed_at DATETIME,
  redeemed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_pairing_expires ON device_pairing_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_device_pairing_status ON device_pairing_sessions(status);

CREATE TABLE IF NOT EXISTS native_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  token TEXT NOT NULL,
  device_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(platform, token)
);

CREATE INDEX IF NOT EXISTS idx_native_push_tokens_user ON native_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_native_push_tokens_device ON native_push_tokens(device_id);
