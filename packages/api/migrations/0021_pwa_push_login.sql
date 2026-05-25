CREATE TABLE IF NOT EXISTS pwa_push_login_attempts (
  device_token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  magic_link_token_hash TEXT,
  push_subscription_json TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pwa_push_login_attempts_email
  ON pwa_push_login_attempts(email);

CREATE INDEX IF NOT EXISTS idx_pwa_push_login_attempts_expires
  ON pwa_push_login_attempts(expires_at);
