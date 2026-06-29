#!/usr/bin/env bash
# Post-deploy smoke checks for the Deno Deploy backup API (@vmp/api-node).
set -euo pipefail

base_url="${1:-}"
max_attempts="${SMOKE_API_NODE_MAX_ATTEMPTS:-12}"
initial_delay_s="${SMOKE_API_NODE_INITIAL_DELAY_S:-5}"

if [ -z "$base_url" ]; then
  echo "usage: smoke-api-node-backup.sh <api-base-url>" >&2
  exit 2
fi

base_url="${base_url%/}"

verify_health() {
  local body="$1"
  node -e '
const body = JSON.parse(process.argv[1]);
const base = process.argv[2];
if (body.status !== "healthy" && body.status !== "degraded") {
  console.error(`Unexpected /api/health status at ${base}:`, body);
  process.exit(1);
}
if (body.mode !== "deno-deploy") {
  console.error(`Expected mode "deno-deploy" at ${base}, got:`, body.mode);
  process.exit(1);
}
const db = body.checks?.database;
if (!db?.ok) {
  console.error(`Database check failed at ${base}:`, db);
  process.exit(1);
}
console.log(`Health OK at ${base} (status=${body.status}, backend=${db.backend})`);
' "$body" "$base_url"
}

verify_homepage() {
  local status="$1"
  local body_file="$2"
  if [ "$status" != "200" ]; then
    echo "GET ${base_url}/api/homepage/content returned HTTP ${status}" >&2
    cat "$body_file" >&2 || true
    exit 1
  fi
  node -e '
const fs = require("node:fs");
const base = process.argv[1];
const file = process.argv[2];
const body = JSON.parse(fs.readFileSync(file, "utf8"));
if (!body || typeof body !== "object") {
  console.error(`Invalid homepage/content JSON at ${base}`);
  process.exit(1);
}
console.log(`Homepage content OK at ${base}`);
' "$base_url" "$body_file"
}

attempt=1
delay_s="$initial_delay_s"
while [ "$attempt" -le "$max_attempts" ]; do
  health_body="$(curl -fsS --connect-timeout 10 --max-time 30 "${base_url}/api/health")"
  if verify_health "$health_body"; then
    homepage_status="$(curl -sS --connect-timeout 10 --max-time 30 -o /tmp/smoke-api-node-homepage.json -w "%{http_code}" "${base_url}/api/homepage/content")"
    if verify_homepage "$homepage_status" /tmp/smoke-api-node-homepage.json; then
      if [ "$attempt" -gt 1 ]; then
        echo "Backup API smoke checks passed after ${attempt} attempts." >&2
      fi
      exit 0
    fi
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Backup API smoke checks failed at ${base_url} after ${max_attempts} attempts." >&2
    exit 1
  fi

  echo "Attempt ${attempt}/${max_attempts}: backup API not ready; retrying in ${delay_s}s…" >&2
  sleep "$delay_s"
  attempt=$((attempt + 1))
  delay_s=$((delay_s * 2))
  if [ "$delay_s" -gt 30 ]; then
    delay_s=30
  fi
done
