-- External purchase ID for legacy billing provider subscription linking.
ALTER TABLE subscriptions ADD COLUMN purchase_id TEXT;

-- Keep one row per non-null purchase_id before enforcing uniqueness.
UPDATE subscriptions
SET purchase_id = NULL
WHERE purchase_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM subscriptions
    WHERE purchase_id IS NOT NULL
    GROUP BY purchase_id
  );

DROP INDEX IF EXISTS idx_subscriptions_purchase_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_purchase_id_unique
  ON subscriptions(purchase_id)
  WHERE purchase_id IS NOT NULL;
