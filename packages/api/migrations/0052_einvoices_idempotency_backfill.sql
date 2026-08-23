-- Backfill idempotency_key for Stripe e-invoices created before dedup queried this column.
-- Safe no-op when keys were already written as stripe:{invoice_id} at insert time.
UPDATE einvoices
SET idempotency_key = 'stripe:' || stripe_invoice_id
WHERE stripe_invoice_id IS NOT NULL
  AND (idempotency_key IS NULL OR TRIM(idempotency_key) = '');
