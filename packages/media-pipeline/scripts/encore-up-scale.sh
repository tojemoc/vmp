#!/usr/bin/env bash
# Durable horizontal scale via Compose --scale (Swarm deploy.replicas is a no-op for plain compose).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HIGH="${ENCORE_WORKER_HIGH_REPLICAS:-2}"
LOW="${ENCORE_WORKER_LOW_REPLICAS:-2}"
PKG="${ENCORE_PACKAGER_REPLICAS:-2}"
exec docker compose \
  -f encore/docker-compose.yml \
  -f encore/docker-compose.scale.yml \
  up -d \
  --scale "encore-worker-high=${HIGH}" \
  --scale "encore-worker-low=${LOW}" \
  --scale "encore-packager=${PKG}"
