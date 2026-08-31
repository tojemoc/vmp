-- Claim Comgate renewals before charging so cron cannot double-charge.
-- pending/charged rows are excluded from due selection; active + period advance
-- happen only after a successful Comgate notification.
ALTER TABLE subscriptions ADD COLUMN renewal_attempt_status TEXT;
ALTER TABLE subscriptions ADD COLUMN renewal_attempt_payment_id TEXT;
ALTER TABLE subscriptions ADD COLUMN renewal_attempt_at DATETIME;
