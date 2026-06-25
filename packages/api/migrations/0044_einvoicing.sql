-- E-invoicing (eFaktura / ISDOC) — invoice ledger, sequences, seller config seeds.
-- Full transmission (Peppol AP, ISDOC delivery) is implemented in follow-up PRs.

CREATE TABLE IF NOT EXISTS einvoicing_sequences (
  jurisdiction TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (jurisdiction, year)
);

CREATE TABLE IF NOT EXISTS einvoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  stripe_invoice_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_subscription_id TEXT,
  plan_type TEXT,
  issue_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  net_amount_cents INTEGER NOT NULL,
  tax_amount_cents INTEGER NOT NULL DEFAULT 0,
  gross_amount_cents INTEGER NOT NULL,
  vat_rate_percent REAL,
  buyer_country TEXT,
  buyer_vat_id TEXT,
  buyer_name TEXT,
  buyer_email TEXT,
  buyer_address_json TEXT,
  buyer_peppol_endpoint_id TEXT,
  buyer_peppol_scheme_id TEXT,
  seller_jurisdiction TEXT NOT NULL,
  format TEXT NOT NULL,
  routing TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  mandate_applies INTEGER NOT NULL DEFAULT 0,
  xml_payload_r2_key TEXT,
  pdf_payload_r2_key TEXT,
  peppol_message_id TEXT,
  peppol_transmission_id TEXT,
  error_message TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_einvoices_user_created ON einvoices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_einvoices_status ON einvoices(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_einvoices_stripe_invoice ON einvoices(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_einvoices_issue_date ON einvoices(issue_date DESC);

INSERT OR IGNORE INTO admin_settings (key, value, updated_at) VALUES
  ('einvoicing_enabled', '0', CURRENT_TIMESTAMP),
  ('einvoicing_sk_voluntary_enabled', '0', CURRENT_TIMESTAMP),
  ('einvoicing_isdoc_enabled', '1', CURRENT_TIMESTAMP),
  ('einvoicing_b2c_mode', 'pdf_archive', CURRENT_TIMESTAMP),
  ('einvoicing_invoice_prefix', 'VMP', CURRENT_TIMESTAMP),
  ('seller_legal_name', '', CURRENT_TIMESTAMP),
  ('seller_vat_id', '', CURRENT_TIMESTAMP),
  ('seller_company_id', '', CURRENT_TIMESTAMP),
  ('seller_address_line1', '', CURRENT_TIMESTAMP),
  ('seller_address_city', '', CURRENT_TIMESTAMP),
  ('seller_address_postal_code', '', CURRENT_TIMESTAMP),
  ('seller_address_country', 'SK', CURRENT_TIMESTAMP),
  ('seller_jurisdiction', 'SK', CURRENT_TIMESTAMP),
  ('seller_peppol_participant_id', '', CURRENT_TIMESTAMP),
  ('seller_peppol_scheme_id', '9935', CURRENT_TIMESTAMP),
  ('peppol_access_point_provider', '', CURRENT_TIMESTAMP),
  ('peppol_access_point_api_url', '', CURRENT_TIMESTAMP),
  ('peppol_access_point_sender_id', '', CURRENT_TIMESTAMP);
