-- GoPay draft provider settings (amounts in major units; currency ISO code).
-- Prices are intentionally empty until an admin configures them — never hardcode.
INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('gopay_monthly_price', '', CURRENT_TIMESTAMP),
  ('gopay_yearly_price', '', CURRENT_TIMESTAMP),
  ('gopay_club_price', '', CURRENT_TIMESTAMP),
  ('gopay_currency', 'CZK', CURRENT_TIMESTAMP);
