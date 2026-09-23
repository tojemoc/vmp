-- Step 10: self-service account deletion + checkout consent persistence.
-- See docs/plans/step-10-account-deletion.md

PRAGMA foreign_keys = ON;

-- Gate auth while a confirmed deletion job is in flight.
ALTER TABLE users ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0;

-- One-time email verification tokens (separate from magic_link_tokens).
CREATE TABLE IF NOT EXISTS account_deletion_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_tokens_user
  ON account_deletion_tokens(user_id);

-- Durable deletion jobs must survive user row deletion (ON DELETE SET NULL).
CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  brevo_contact_identifier TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Step flags: 0 = incomplete, 1 = done
  subscription_cancelled INTEGER NOT NULL DEFAULT 0,
  einvoices_anonymized INTEGER NOT NULL DEFAULT 0,
  r2_sanitized INTEGER NOT NULL DEFAULT 0,
  db_cleaned INTEGER NOT NULL DEFAULT 0,
  brevo_deleted INTEGER NOT NULL DEFAULT 0,
  user_deleted INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_jobs_status
  ON account_deletion_jobs(status, updated_at);

-- R2 invoice payload inventory keyed by job (survives user/invoice detach).
CREATE TABLE IF NOT EXISTS account_deletion_r2_objects (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  outcome TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES account_deletion_jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, object_key)
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_r2_objects_job
  ON account_deletion_r2_objects(job_id, outcome);

-- Immutable checkout withdrawal / terms consent (persisted at checkout time).
CREATE TABLE IF NOT EXISTS checkout_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  checkout_session_id TEXT,
  provider_session_id TEXT,
  subscription_id TEXT,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_checkout_consents_user
  ON checkout_consents(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_consents_provider_session
  ON checkout_consents(provider, provider_session_id);
