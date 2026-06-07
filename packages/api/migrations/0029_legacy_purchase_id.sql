-- External purchase ID for legacy billing provider subscription linking.
ALTER TABLE subscriptions ADD COLUMN purchase_id TEXT;
CREATE INDEX IF NOT EXISTS idx_subscriptions_purchase_id ON subscriptions(purchase_id);
