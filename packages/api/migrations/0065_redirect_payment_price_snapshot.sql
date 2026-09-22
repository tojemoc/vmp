-- Immutable price snapshots for GoPay/Comgate amount verification.
-- Checkout sessions capture the expected amount at create time; subscriptions
-- inherit it so renewals do not re-read live admin_settings prices.

ALTER TABLE payment_checkout_sessions ADD COLUMN expected_amount_minor INTEGER;
ALTER TABLE payment_checkout_sessions ADD COLUMN expected_currency TEXT;

ALTER TABLE subscriptions ADD COLUMN expected_amount_minor INTEGER;
ALTER TABLE subscriptions ADD COLUMN expected_currency TEXT;
