-- Persist Stripe cancel-at-period-end so the account page can show "Access until"
-- instead of "Renews on" while status remains active/trialing.
ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
