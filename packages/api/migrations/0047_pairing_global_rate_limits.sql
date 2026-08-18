-- Distributed/global pairing budgets (in addition to per-IP counters).
-- Tunable via admin_settings without redeploying the Worker.

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('pairing_start_limit_global', '60', CURRENT_TIMESTAMP),
  ('pairing_poll_limit_global', '600', CURRENT_TIMESTAMP),
  ('pairing_preview_limit_global', '120', CURRENT_TIMESTAMP);
