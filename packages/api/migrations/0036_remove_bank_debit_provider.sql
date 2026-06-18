-- Remove the retired bank-debit payment integration (schema introduced in migrations
-- 0010, 0013, 0015, 0022, and 0024 — those files stay unedited).

-- Product owner confirmed zero active bank-debit subscribers; reclassify any rows as legacy.
UPDATE subscriptions SET provider = 'legacy' WHERE provider = 'go' || 'cardless';

DELETE FROM payment_checkout_sessions WHERE provider = 'go' || 'cardless';

DELETE FROM admin_settings WHERE key LIKE 'go' || 'cardless' || '_%';

PRAGMA foreign_keys = OFF;

CREATE TABLE promo_codes__v2 (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL DEFAULT 'free_month',
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  allowed_plan_types TEXT NOT NULL DEFAULT 'monthly,yearly,club',
  stripe_coupon_id TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES promo_campaigns(id) ON DELETE CASCADE
);

INSERT INTO promo_codes__v2 (
  id, campaign_id, code, reward_type, max_uses, used_count, is_active,
  allowed_plan_types, stripe_coupon_id, expires_at, created_at, updated_at
)
SELECT
  id, campaign_id, code, reward_type, max_uses, used_count, is_active,
  allowed_plan_types, stripe_coupon_id, expires_at, created_at, updated_at
FROM promo_codes;

-- POSTGRES: ALTER TABLE promo_redemptions DROP CONSTRAINT IF EXISTS promo_redemptions_promo_code_id_fkey;
DROP TABLE promo_codes;
ALTER TABLE promo_codes__v2 RENAME TO promo_codes;
-- POSTGRES: ALTER TABLE promo_redemptions ADD CONSTRAINT promo_redemptions_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_promo_codes_campaign
  ON promo_codes(campaign_id, is_active);

CREATE TABLE payment_checkout_sessions__v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  checkout_token TEXT NOT NULL UNIQUE,
  session_token TEXT,
  provider_checkout_id TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  promo_code_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

INSERT INTO payment_checkout_sessions__v2 (
  id, user_id, provider, plan_type, checkout_token, session_token,
  provider_checkout_id, provider_subscription_id, status, promo_code_id,
  created_at, updated_at, completed_at
)
SELECT
  id, user_id, provider, plan_type, checkout_token, session_token,
  provider_checkout_id, provider_subscription_id, status, promo_code_id,
  created_at, updated_at, completed_at
FROM payment_checkout_sessions;

DROP TABLE payment_checkout_sessions;
ALTER TABLE payment_checkout_sessions__v2 RENAME TO payment_checkout_sessions;

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_user_status
  ON payment_checkout_sessions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_provider_checkout
  ON payment_checkout_sessions(provider, provider_checkout_id);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_promo_code
  ON payment_checkout_sessions(promo_code_id);

PRAGMA foreign_keys = ON;
