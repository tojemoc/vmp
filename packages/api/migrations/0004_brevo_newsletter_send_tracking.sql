-- Durable send tracking + claim time for stale recovery (newsletter hardening).
-- Idempotent: safe if runtime ALTER in brevo.js already added columns.
ALTER TABLE brevo_newsletter_sends ADD COLUMN IF NOT EXISTS send_requested INTEGER DEFAULT 0;
UPDATE brevo_newsletter_sends SET send_requested = 0 WHERE send_requested IS NULL;
ALTER TABLE brevo_newsletter_sends ALTER COLUMN send_requested SET NOT NULL;

ALTER TABLE brevo_newsletter_sends ADD COLUMN IF NOT EXISTS claim_acquired_at TEXT;

-- Rows that already have a Brevo campaign but no sent_at should count as send-requested for idempotency.
UPDATE brevo_newsletter_sends
SET send_requested = 1
WHERE campaign_id IS NOT NULL AND sent_at IS NULL AND (send_requested = 0 OR send_requested IS NULL);
