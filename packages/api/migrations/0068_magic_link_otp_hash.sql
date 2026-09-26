-- Checkout popup UX: email confirmation codes alongside magic links.
-- See docs/plans/checkout-popup-ux.md

PRAGMA foreign_keys = ON;

ALTER TABLE magic_link_tokens ADD COLUMN otp_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_magic_link_otp_hash
  ON magic_link_tokens(otp_hash)
  WHERE otp_hash IS NOT NULL;
