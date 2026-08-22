-- Device pairing rate limits (per-minute counters in RATE_LIMIT_KV).
-- Tunable via admin_settings without redeploying the Worker.

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('pairing_start_limit_per_ip', '10', CURRENT_TIMESTAMP),
  ('pairing_poll_limit_per_ip', '120', CURRENT_TIMESTAMP),
  ('pairing_preview_limit_per_ip', '30', CURRENT_TIMESTAMP),
  ('pairing_preview_limit_per_code', '8', CURRENT_TIMESTAMP);
