INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('legacy_manage_subscription_url', '', CURRENT_TIMESTAMP),
  ('legacy_provider_name', '', CURRENT_TIMESTAMP),
  ('legacy_show_manage_button', '0', CURRENT_TIMESTAMP),
  ('monthly_enabled', '1', CURRENT_TIMESTAMP),
  ('yearly_enabled', '1', CURRENT_TIMESTAMP),
  ('club_enabled', '1', CURRENT_TIMESTAMP),
  ('monthly_label', 'Monthly', CURRENT_TIMESTAMP),
  ('yearly_label', 'Yearly', CURRENT_TIMESTAMP),
  ('club_label', 'Club', CURRENT_TIMESTAMP),
  ('monthly_interval', 'month', CURRENT_TIMESTAMP),
  ('yearly_interval', 'year', CURRENT_TIMESTAMP),
  ('club_interval', 'year', CURRENT_TIMESTAMP);
