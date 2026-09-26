#!/usr/bin/env bash
# Repair Wrangler `d1_migrations` when schema was applied via ensure_d1 / d1 execute
# but `wrangler d1 migrations apply` still tries non-idempotent CREATE/ALTER and fails
# (e.g. "table irl_events already exists").
#
# Preferred remote workflow remains: packages/api/scripts/ensure_d1_required_schema.sh
# — see DEPLOYMENT.md → "D1 schema on deploy".
#
# Usage (from packages/api):
#   bash ./scripts/repair_d1_wrangler_migration_history.sh --remote
#   bash ./scripts/repair_d1_wrangler_migration_history.sh --local
set -euo pipefail

DB_NAME="${DB_NAME:-video-subscription-db}"
MODE_FLAG="--remote"
if [[ "${1:-}" == "--local" ]]; then
  MODE_FLAG="--local"
elif [[ "${1:-}" == "--remote" || -z "${1:-}" ]]; then
  MODE_FLAG="--remote"
else
  echo "Usage: $0 [--remote|--local]" >&2
  exit 2
fi

run_scalar() {
  local sql="$1"
  npx wrangler d1 execute "$DB_NAME" "$MODE_FLAG" --command "$sql" --json \
    | node -e '
      const fs = require("fs");
      const input = fs.readFileSync(0, "utf8").trim();
      const payload = JSON.parse(input);
      const firstResult = payload?.[0]?.results?.[0] ?? {};
      const firstValue = Object.values(firstResult)[0];
      process.stdout.write(String(firstValue ?? 0));
    '
}

table_exists() {
  local table="$1"
  local n
  n="$(run_scalar "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '$table';")"
  [[ "$n" == "1" ]]
}

column_exists() {
  local table="$1"
  local column="$2"
  local n
  n="$(run_scalar "SELECT COUNT(*) AS n FROM pragma_table_info('$table') WHERE name = '$column';")"
  [[ "$n" == "1" ]]
}

migration_recorded() {
  local name="$1"
  if ! table_exists d1_migrations; then
    return 1
  fi
  local n
  n="$(run_scalar "SELECT COUNT(*) AS n FROM d1_migrations WHERE name = '$name';")"
  [[ "$n" != "0" ]]
}

stamp_migration() {
  local name="$1"
  if migration_recorded "$name"; then
    echo "[repair-d1] already stamped: $name"
    return 0
  fi
  if ! table_exists d1_migrations; then
    echo "[repair-d1] ERROR: d1_migrations table missing — run wrangler d1 migrations apply once to create it, or skip repair and use ensure_d1 only." >&2
    exit 1
  fi
  echo "[repair-d1] stamping: $name"
  # Wrangler records name only; id/applied_at defaults are fine on D1.
  npx wrangler d1 execute "$DB_NAME" "$MODE_FLAG" --command \
    "INSERT INTO d1_migrations (name) VALUES ('$name');"
}

echo "[repair-d1] ${DB_NAME} (${MODE_FLAG})"
echo "[repair-d1] Prefer ensure_d1_required_schema.sh for remote schema; this only syncs Wrangler history."

# 0067 — Club IRL tables (also created by ensure_d1_club_entitlements.sql)
if table_exists irl_events && table_exists irl_event_rsvps; then
  stamp_migration "0067_club_irl_events_and_ads.sql"
else
  echo "[repair-d1] skip 0067: irl_events / irl_event_rsvps not both present (run ensure_d1 first)"
fi

# 0068 — magic_link_tokens.otp_hash (ensure path / manual ALTER may have added it)
if column_exists magic_link_tokens otp_hash; then
  stamp_migration "0068_magic_link_otp_hash.sql"
else
  echo "[repair-d1] skip 0068: magic_link_tokens.otp_hash missing (run ensure_d1 or apply 0068)"
fi

echo "[repair-d1] done"
echo "[repair-d1] Next: either rely on ensure_d1, or re-run: npx wrangler d1 migrations apply ${DB_NAME} ${MODE_FLAG}"
