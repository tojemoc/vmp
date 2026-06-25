#!/usr/bin/env bash
# Verify a deployed Nuxt frontend baked the expected git SHA into runtime config.
set -euo pipefail

url="${1:-}"
expected="${EXPECTED_SHA:-}"

if [ -z "$url" ]; then
  echo "usage: smoke-frontend-build-revision.sh <frontend-origin>" >&2
  exit 2
fi

if [ -z "$expected" ]; then
  echo "EXPECTED_SHA is required" >&2
  exit 2
fi

target="${url%/}/login"
html="$(curl -fsS "$target")"

node -e '
const expected = process.argv[1];
const html = process.argv[2];
const target = process.argv[3];
const needle = `gitCommit:"${expected}"`;
if (!html.includes(needle)) {
  console.error(`Deployed frontend at ${target} is missing ${needle}`);
  if (!html.includes("gitCommit:")) {
    console.error("No gitCommit in __NUXT__.config — stale build or Workers build/deployment issue.");
  }
  process.exit(1);
}
console.log(`gitCommit verified at ${target}: ${expected.slice(0, 12)}…`);
' "$expected" "$html" "$target"
