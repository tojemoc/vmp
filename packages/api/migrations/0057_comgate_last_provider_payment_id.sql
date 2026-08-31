-- Store each Comgate renewal transId separately from the original checkout
-- transId kept on provider_subscription_id (initRecurringId).
ALTER TABLE subscriptions ADD COLUMN last_provider_payment_id TEXT;
