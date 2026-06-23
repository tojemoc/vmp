#!/usr/bin/env bash
# Fingerprint first-party packages/ source with SCANOSS OSSKB (snippet provenance).
set -euo pipefail

SCANOSS_BIN="${SCANOSS_BIN:-scanoss-py}"
OUTPUT="${SNIPPET_SCAN_OUTPUT:-snippet-report.json}"
API_URL="${SCANOSS_API_URL:-https://api.osskb.org}"

if ! command -v "$SCANOSS_BIN" >/dev/null 2>&1; then
  echo "::error::scanoss-py not found on PATH (install with: pip install scanoss)" >&2
  exit 1
fi

args=(
  scan packages
  --apiurl "$API_URL"
  --settings scanoss.json
  --output "$OUTPUT"
  --format plain
  --threads 4
  --skip-folder node_modules
  --skip-folder .nuxt
  --skip-folder dist
  --skip-folder .wrangler
  --skip-folder coverage
  --skip-folder .nx
  --skip-extension .min.js
  --skip-extension .map
)

if [[ -n "${SCANOSS_API_KEY:-}" ]]; then
  args+=(--key "$SCANOSS_API_KEY")
fi

echo "Running SCANOSS snippet scan on packages/ (output: $OUTPUT)"
"$SCANOSS_BIN" "${args[@]}"

if [[ ! -s "$OUTPUT" ]]; then
  echo "::warning::SCANOSS produced no report (API rate limit or empty scan). Upload skipped."
  exit 0
fi

match_count="$(python3 - <<'PY' "$OUTPUT"
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path))
except Exception:
    print(0)
    raise SystemExit
if isinstance(data, list):
    print(len(data))
elif isinstance(data, dict):
    print(len(data.get("matches", data.get("files", []))))
else:
    print(0)
PY
)"
echo "Snippet scan complete: $match_count finding(s) in $OUTPUT"
