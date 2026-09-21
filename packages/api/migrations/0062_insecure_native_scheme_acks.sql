-- Temporary staging-only acknowledgments for insecure vmp:// magic-link handoff (SideStore PoC).
-- Bound to a single unused magic-link token; purged when the link expires or is consumed.
CREATE TABLE IF NOT EXISTS insecure_native_scheme_acks (
  id TEXT PRIMARY KEY NOT NULL,
  magic_link_token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_insecure_native_scheme_acks_expires
  ON insecure_native_scheme_acks(expires_at);
