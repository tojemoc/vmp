#!/usr/bin/env bash
# Idempotent D1 schema the current API Worker requires.
# Do not run `wrangler d1 migrations apply` for the historical migrations/
# tree — those files were applied with `d1 execute --file` and are not Wrangler
# migration history. This script only adds missing columns/tables.
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

column_exists() {
  local table="$1"
  local column="$2"
  local n
  n="$(run_scalar "SELECT COUNT(*) AS n FROM pragma_table_info('$table') WHERE name = '$column';")"
  [[ "$n" == "1" ]]
}

echo "[ensure-d1] ${DB_NAME} (${MODE_FLAG})"

if column_exists users deletion_pending; then
  echo "[ensure-d1] users.deletion_pending already present"
else
  echo "[ensure-d1] adding users.deletion_pending"
  npx wrangler d1 execute "$DB_NAME" "$MODE_FLAG" --command \
    "ALTER TABLE users ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0;"
fi

echo "[ensure-d1] ensuring Step 10 tables/indexes"
npx wrangler d1 execute "$DB_NAME" "$MODE_FLAG" --file=./scripts/ensure_d1_step10_tables.sql

echo "[ensure-d1] done"
