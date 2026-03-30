-- Auth schema
-- Run: wrangler d1 execute video-subscription-db --file=./migrations/0004_auth.sql

-- Add role to existing users table.
-- SQLite doesn't support ADD COLUMN with a CHECK constraint directly,
-- so we add the column first, then enforce valid values at the application layer
-- (the CHECK in INSERT/UPDATE statements in auth.js).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';

-- One-time sign-in tokens (magic links).
-- We store a SHA-256 hash of the raw token, never the token itself.
-- If this table is ever dumped, an attacker still can't replay any links.
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME,                        -- NULL = not yet used
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Long-lived refresh tokens (30 days).
-- Also stored as SHA-256 hashes. Deleted on use (rotation) and on logout.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Indexes for the hot paths (token lookup by hash, cleanup by user)
CREATE INDEX IF NOT EXISTS idx_magic_link_hash    ON magic_link_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_user_id    ON refresh_tokens (user_id);

-- Seed the test users with explicit roles so existing dev data still works
UPDATE users SET role = 'viewer' WHERE role IS NULL OR role = '';
