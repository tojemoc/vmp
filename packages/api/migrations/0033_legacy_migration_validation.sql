-- Tracks sandbox/production validation attempts per legacy subscription.
ALTER TABLE subscriptions ADD COLUMN legacy_validation_status TEXT;
-- values: null (not checked), 'valid', 'invalid', 'error'

ALTER TABLE subscriptions ADD COLUMN legacy_validated_at DATETIME;

ALTER TABLE subscriptions ADD COLUMN legacy_validation_error TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_legacy_validation
  ON subscriptions(provider, legacy_validation_status)
  WHERE provider = 'legacy';
