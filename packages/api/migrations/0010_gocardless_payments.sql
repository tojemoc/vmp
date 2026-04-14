ALTER TABLE subscriptions ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE subscriptions ADD COLUMN provider_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN provider_customer_id TEXT;

UPDATE subscriptions
SET provider = 'stripe'
WHERE provider IS NULL OR trim(provider) = '';

UPDATE subscriptions
SET provider_subscription_id = stripe_subscription_id
WHERE provider_subscription_id IS NULL
  AND stripe_subscription_id IS NOT NULL
  AND trim(stripe_subscription_id) <> '';

UPDATE subscriptions
SET provider_customer_id = stripe_customer_id
WHERE provider_customer_id IS NULL
  AND stripe_customer_id IS NOT NULL
  AND trim(stripe_customer_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_external
  ON subscriptions(provider, provider_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_user
  ON subscriptions(provider, user_id);

CREATE TABLE IF NOT EXISTS payment_checkout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  checkout_token TEXT NOT NULL UNIQUE,
  session_token TEXT,
  provider_checkout_id TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_user_status
  ON payment_checkout_sessions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_provider_checkout
  ON payment_checkout_sessions(provider, provider_checkout_id);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('payments_enabled_providers', 'stripe', CURRENT_TIMESTAMP),
  ('gocardless_plan_monthly', 'VMP Monthly', CURRENT_TIMESTAMP),
  ('gocardless_plan_yearly', 'VMP Yearly', CURRENT_TIMESTAMP),
  ('gocardless_plan_club', 'VMP Club', CURRENT_TIMESTAMP),
  ('gocardless_currency', 'EUR', CURRENT_TIMESTAMP),
  ('gocardless_manage_subscription_url', '', CURRENT_TIMESTAMP);
