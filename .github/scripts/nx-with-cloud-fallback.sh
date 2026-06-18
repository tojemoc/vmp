#!/usr/bin/env bash
# Run Nx with Nx Cloud when available; retry locally when Cloud is unavailable.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: nx-with-cloud-fallback.sh <nx-args...>" >&2
  exit 2
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

set +e
npm exec nx -- "$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
set -e

if [ "$code" -eq 0 ]; then
  exit 0
fi

if grep -Eqi 'nx cloud|organization has been disabled|exceeding the free plan|invalid credentials.*ci access token|workspace could not be found with the provided ci access token|unable to connect to nx cloud|cannot connect to nx cloud' "$log"; then
  echo "::warning::Nx Cloud unavailable; retrying without Nx Cloud (local Nx only)."
  NX_NO_CLOUD=true npm exec nx -- "$@" --skip-nx-cache
  exit $?
fi

echo "::error::Nx command failed for a reason other than Nx Cloud availability."
exit "$code"
