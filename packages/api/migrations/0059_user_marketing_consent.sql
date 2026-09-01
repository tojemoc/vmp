-- Record explicit marketing (newsletter) consent so the Brevo list sync can gate
-- on it. A paid subscription is not marketing consent: the personal data notice
-- (migrations 0038 / 0054) promises EU readers that consent is asked for before
-- any non-necessary marketing tool. NULL marketing_consent_at means "no consent",
-- so the user must never be added to the marketing list on billing status alone.
-- marketing_consent_version records which notice version the user agreed to.
ALTER TABLE users ADD COLUMN marketing_consent_at DATETIME;
ALTER TABLE users ADD COLUMN marketing_consent_version TEXT;
