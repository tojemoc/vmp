ALTER TABLE promo_codes ADD COLUMN gocardless_discount_percent REAL;

ALTER TABLE promo_codes ADD COLUMN gocardless_plan_code TEXT;

INSERT INTO admin_settings(key, value, updated_at)
VALUES
  ('gocardless_promo_requires_plan_code', '0', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;
