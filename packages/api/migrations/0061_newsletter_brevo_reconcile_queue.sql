-- Durable Brevo newsletter reconciliation queue.
-- Opt-out requests that fail the immediate remove are enqueued here; the
-- Worker scheduled handler drains the queue and re-runs membership reconcile.
CREATE TABLE IF NOT EXISTS newsletter_brevo_reconcile_queue (
  user_id TEXT PRIMARY KEY,
  enqueued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
