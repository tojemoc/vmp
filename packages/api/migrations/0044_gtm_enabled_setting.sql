-- GTM is opt-in via Admin → System (gtm_enabled). No build-time container ID.
INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
VALUES ('gtm_enabled', '0', CURRENT_TIMESTAMP);
