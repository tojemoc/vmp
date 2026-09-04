-- Per-user RSS token version, folded into the personal feed HMAC so a leaked
-- /api/feed/:userId/:token URL can be revoked. Rotating increments this value,
-- which changes the token and invalidates every previously issued personal URL.
ALTER TABLE users ADD COLUMN rss_token_version INTEGER NOT NULL DEFAULT 0;
