-- Backfill expected_amount_minor / expected_currency for existing GoPay + Comgate
-- subscriptions after 0065 introduced fail-closed renewal verification.
--
-- Compatibility policy (explicit):
--   1. Prefer the newest payment_checkout_sessions snapshot for the same provider
--      identity (provider_subscription_id or provider_checkout_id match) when that
--      session already has a positive amount and non-empty currency.
--   2. Else freeze the then-current provider admin_settings plan price (major →
--      minor units) and provider currency onto the subscription. When the provider
--      currency is EUR and the provider-specific price key is empty/non-positive,
--      fall back to shared monthly_price_eur / yearly_price_eur / club_price_eur
--      (mirrors getEffectivePricingSettings).
--   3. Rows that still have no recoverable amount/currency remain NULL. Renewal
--      webhooks continue to reject with *_missing_price until ops configures
--      prices or the customer starts a new checkout (which persists a snapshot).
-- Stripe / legacy / other providers are left unchanged.
--
-- This is a one-time migration-time freeze so existing redirect renewals are not
-- blocked solely by the fail-closed verifier introduced with 0065.

-- 1) Checkout-session snapshots (authoritative when present).
UPDATE subscriptions
SET
  expected_amount_minor = (
    SELECT pcs.expected_amount_minor
    FROM payment_checkout_sessions AS pcs
    WHERE pcs.provider = subscriptions.provider
      AND pcs.expected_amount_minor IS NOT NULL
      AND pcs.expected_amount_minor > 0
      AND pcs.expected_currency IS NOT NULL
      AND TRIM(pcs.expected_currency) <> ''
      AND (
        (
          pcs.provider_subscription_id IS NOT NULL
          AND pcs.provider_subscription_id = subscriptions.provider_subscription_id
        )
        OR (
          pcs.provider_checkout_id IS NOT NULL
          AND pcs.provider_checkout_id = subscriptions.provider_subscription_id
        )
      )
    ORDER BY datetime(COALESCE(pcs.completed_at, pcs.updated_at, pcs.created_at)) DESC
    LIMIT 1
  ),
  expected_currency = (
    SELECT UPPER(TRIM(pcs.expected_currency))
    FROM payment_checkout_sessions AS pcs
    WHERE pcs.provider = subscriptions.provider
      AND pcs.expected_amount_minor IS NOT NULL
      AND pcs.expected_amount_minor > 0
      AND pcs.expected_currency IS NOT NULL
      AND TRIM(pcs.expected_currency) <> ''
      AND (
        (
          pcs.provider_subscription_id IS NOT NULL
          AND pcs.provider_subscription_id = subscriptions.provider_subscription_id
        )
        OR (
          pcs.provider_checkout_id IS NOT NULL
          AND pcs.provider_checkout_id = subscriptions.provider_subscription_id
        )
      )
    ORDER BY datetime(COALESCE(pcs.completed_at, pcs.updated_at, pcs.created_at)) DESC
    LIMIT 1
  )
WHERE provider IN ('gopay', 'comgate')
  AND (
    expected_amount_minor IS NULL
    OR expected_amount_minor <= 0
    OR expected_currency IS NULL
    OR TRIM(COALESCE(expected_currency, '')) = ''
  );

-- 2a) Provider-specific admin_settings prices (one-time freeze of configured amount).
UPDATE subscriptions
SET
  expected_amount_minor = CAST(
    ROUND(
      CAST(
        REPLACE(REPLACE(TRIM(p.value), ' ', ''), ',', '.') AS REAL
      ) * 100
    ) AS INTEGER
  ),
  expected_currency = COALESCE(
    NULLIF(
      UPPER(
        TRIM(
          (
            SELECT a.value
            FROM admin_settings AS a
            WHERE a.key = subscriptions.provider || '_currency'
          )
        )
      ),
      ''
    ),
    'CZK'
  )
FROM admin_settings AS p
WHERE subscriptions.provider IN ('gopay', 'comgate')
  AND (
    subscriptions.expected_amount_minor IS NULL
    OR subscriptions.expected_amount_minor <= 0
  )
  AND p.key = CASE LOWER(TRIM(COALESCE(subscriptions.plan_type, 'monthly')))
    WHEN 'yearly' THEN subscriptions.provider || '_yearly_price'
    WHEN 'club' THEN subscriptions.provider || '_club_price'
    ELSE subscriptions.provider || '_monthly_price'
  END
  AND TRIM(COALESCE(p.value, '')) <> ''
  AND CAST(REPLACE(REPLACE(TRIM(p.value), ' ', ''), ',', '.') AS REAL) > 0;

-- 2b) EUR shared-price fallback when provider currency is EUR and provider price missing.
UPDATE subscriptions
SET
  expected_amount_minor = CAST(
    ROUND(
      CAST(
        REPLACE(REPLACE(TRIM(p.value), ' ', ''), ',', '.') AS REAL
      ) * 100
    ) AS INTEGER
  ),
  expected_currency = 'EUR'
FROM admin_settings AS p
WHERE subscriptions.provider IN ('gopay', 'comgate')
  AND (
    subscriptions.expected_amount_minor IS NULL
    OR subscriptions.expected_amount_minor <= 0
  )
  AND UPPER(
    TRIM(
      COALESCE(
        (
          SELECT a.value
          FROM admin_settings AS a
          WHERE a.key = subscriptions.provider || '_currency'
        ),
        ''
      )
    )
  ) = 'EUR'
  AND p.key = CASE LOWER(TRIM(COALESCE(subscriptions.plan_type, 'monthly')))
    WHEN 'yearly' THEN 'yearly_price_eur'
    WHEN 'club' THEN 'club_price_eur'
    ELSE 'monthly_price_eur'
  END
  AND TRIM(COALESCE(p.value, '')) <> ''
  AND CAST(REPLACE(REPLACE(TRIM(p.value), ' ', ''), ',', '.') AS REAL) > 0;

-- 2c) Currency-only gaps when amount already exists (session/admin amount without currency).
UPDATE subscriptions
SET expected_currency = COALESCE(
  NULLIF(
    UPPER(
      TRIM(
        (
          SELECT a.value
          FROM admin_settings AS a
          WHERE a.key = subscriptions.provider || '_currency'
        )
      )
    ),
    ''
  ),
  'CZK'
)
WHERE provider IN ('gopay', 'comgate')
  AND expected_amount_minor IS NOT NULL
  AND expected_amount_minor > 0
  AND (expected_currency IS NULL OR TRIM(COALESCE(expected_currency, '')) = '');

-- 3) Remaining NULL snapshots are intentional: renewals fail closed with *_missing_price.
