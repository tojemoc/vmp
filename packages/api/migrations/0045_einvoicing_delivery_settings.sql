-- E-invoicing delivery settings (Peppol AP stub / ISDOC email delivery).
-- Extends 0044_einvoicing.sql; real AP credentials remain Worker secrets.

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('einvoicing_delivery_mode', 'stub', CURRENT_TIMESTAMP),
  ('einvoicing_cz_electronic_consent_ref', 'VMP-CZ-B2B-ELECTRONIC-CONSENT', CURRENT_TIMESTAMP),
  ('einvoicing_isdoc_delivery_method', 'email_stub', CURRENT_TIMESTAMP);
