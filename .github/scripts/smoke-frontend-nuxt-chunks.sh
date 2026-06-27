#!/usr/bin/env bash
# Verify deployed Nuxt entry chunks referenced from HTML are reachable (not 503/404).
set -euo pipefail

url="${1:-}"
max_attempts="${SMOKE_NUXT_CHUNKS_MAX_ATTEMPTS:-12}"
initial_delay_s="${SMOKE_NUXT_CHUNKS_INITIAL_DELAY_S:-5}"

if [ -z "$url" ]; then
  echo "usage: smoke-frontend-nuxt-chunks.sh <frontend-origin>" >&2
  exit 2
fi

target="${url%/}/"

verify_chunks() {
  local html="$1"
  node -e '
const origin = process.argv[1];
const html = process.argv[2];
const chunkPaths = [...new Set(
  [...html.matchAll(/\/_nuxt\/[A-Za-z0-9_.-]+\.(?:js|css)/g)].map((match) => match[0]),
)];
if (chunkPaths.length === 0) {
  console.error(`No /_nuxt chunk references found in HTML from ${origin}`);
  process.exit(1);
}
console.error(`Found ${chunkPaths.length} unique /_nuxt asset references in ${origin}`);
process.stdout.write(chunkPaths.join("\n"));
' "$target" "$html" > /tmp/smoke-nuxt-chunks.txt

  local failed=0
  while IFS= read -r chunk_path; do
    [ -n "$chunk_path" ] || continue
    local status
    status="$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "${target%/}${chunk_path}")"
    if [ "$status" != "200" ]; then
      echo "Chunk ${chunk_path} returned HTTP ${status}" >&2
      failed=1
    fi
  done < /tmp/smoke-nuxt-chunks.txt

  if [ "$failed" -ne 0 ]; then
    return 1
  fi

  local chunk_count
  chunk_count="$(wc -l < /tmp/smoke-nuxt-chunks.txt | tr -d " ")"
  echo "Verified ${chunk_count} /_nuxt chunks at ${target}"
}

attempt=1
delay_s="$initial_delay_s"
while [ "$attempt" -le "$max_attempts" ]; do
  html="$(curl -fsS --connect-timeout 10 --max-time 30 "$target")"

  if verify_chunks "$html"; then
    if [ "$attempt" -gt 1 ]; then
      echo "/_nuxt chunks verified after ${attempt} attempts (Workers edge propagation delay)." >&2
    fi
    exit 0
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "/_nuxt chunk smoke check failed after ${max_attempts} attempts at ${target}" >&2
    exit 1
  fi

  echo "Attempt ${attempt}/${max_attempts}: /_nuxt chunks not ready; retrying in ${delay_s}s…" >&2
  sleep "$delay_s"
  attempt=$((attempt + 1))
  delay_s=$((delay_s * 2))
  if [ "$delay_s" -gt 30 ]; then
    delay_s=30
  fi
done
