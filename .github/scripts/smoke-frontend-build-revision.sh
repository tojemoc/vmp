#!/usr/bin/env bash
# Verify a deployed Nuxt frontend baked the expected git SHA into runtime config.
set -euo pipefail

url="${1:-}"
expected="${EXPECTED_SHA:-}"
max_attempts="${SMOKE_REVISION_MAX_ATTEMPTS:-12}"
initial_delay_s="${SMOKE_REVISION_INITIAL_DELAY_S:-5}"

if [ -z "$url" ]; then
  echo "usage: smoke-frontend-build-revision.sh <frontend-origin>" >&2
  exit 2
fi

if [ -z "$expected" ]; then
  echo "EXPECTED_SHA is required" >&2
  exit 2
fi

target="${url%/}/login"
needle="gitCommit:\"${expected}\""

verify_html() {
  local html="$1"
  node -e '
const expected = process.argv[1];
const html = process.argv[2];
const target = process.argv[3];
const needle = `gitCommit:"${expected}"`;
if (!html.includes(needle)) {
  if (!html.includes("gitCommit:")) {
    console.error(`No gitCommit in __NUXT__.config at ${target} — stale build or Workers deployment issue.`);
  } else {
    const match = html.match(/gitCommit:"([^"]+)"/);
    const found = match ? match[1] : "(unknown)";
    console.error(`Found gitCommit:"${found}" at ${target}, expected gitCommit:"${expected}"`);
  }
  process.exit(1);
}
console.log(`gitCommit verified at ${target}: ${expected.slice(0, 12)}…`);
' "$expected" "$html" "$target"
}

attempt=1
delay_s="$initial_delay_s"
while [ "$attempt" -le "$max_attempts" ]; do
  html="$(curl -fsS --connect-timeout 10 --max-time 30 "$target")"

  if verify_html "$html"; then
    if [ "$attempt" -gt 1 ]; then
      echo "gitCommit matched after ${attempt} attempts (Workers edge propagation delay)." >&2
    fi
    exit 0
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Deployed frontend at ${target} is missing ${needle} after ${max_attempts} attempts." >&2
    exit 1
  fi

  echo "Attempt ${attempt}/${max_attempts}: revision not live yet; retrying in ${delay_s}s…" >&2
  sleep "$delay_s"
  attempt=$((attempt + 1))
  delay_s=$((delay_s * 2))
  if [ "$delay_s" -gt 30 ]; then
    delay_s=30
  fi
done
