CREATE TABLE IF NOT EXISTS pwa_handoffs (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pwa_handoffs_code ON pwa_handoffs(code);
