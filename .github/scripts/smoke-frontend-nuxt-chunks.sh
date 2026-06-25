#!/usr/bin/env bash
# Verify deployed Nuxt entry chunks referenced from HTML are reachable (not 503/404).
set -euo pipefail

url="${1:-}"

if [ -z "$url" ]; then
  echo "usage: smoke-frontend-nuxt-chunks.sh <frontend-origin>" >&2
  exit 2
fi

target="${url%/}/"
html="$(curl -fsS --connect-timeout 10 --max-time 30 "$target")"

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

failed=0
while IFS= read -r chunk_path; do
  [ -n "$chunk_path" ] || continue
  status="$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w "%{http_code}" "${target%/}${chunk_path}")"
  if [ "$status" != "200" ]; then
    echo "Chunk ${chunk_path} returned HTTP ${status}" >&2
    failed=1
  fi
done < /tmp/smoke-nuxt-chunks.txt

if [ "$failed" -ne 0 ]; then
  exit 1
fi

chunk_count="$(wc -l < /tmp/smoke-nuxt-chunks.txt | tr -d " ")"
echo "Verified ${chunk_count} /_nuxt chunks at ${target}"
