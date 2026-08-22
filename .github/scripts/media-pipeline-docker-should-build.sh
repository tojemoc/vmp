#!/usr/bin/env bash
# Decide whether the media-pipeline Docker image must be rebuilt for a commit range.
# The Dockerfile copies the root package*.json and runs `npm ci --workspaces`, so
# lockfile-only Dependabot merges for @vmp/media-pipeline / @vmp/storage must still
# rebuild :latest — but unrelated monorepo lockfile churn should not.
set -euo pipefail

BASE="${1:-}"
HEAD="${2:-}"

if [[ -z "$BASE" || -z "$HEAD" ]]; then
  echo "usage: media-pipeline-docker-should-build.sh <base-sha> <head-sha>" >&2
  exit 2
fi

if [[ "$BASE" == "0000000000000000000000000000000000000000" ]]; then
  echo "true"
  exit 0
fi

mapfile -t files < <(git diff --name-only "$BASE" "$HEAD")

lockfile_changed=false
for file in "${files[@]}"; do
  case "$file" in
    packages/media-pipeline/*|packages/storage/*|.dockerignore|.github/workflows/media-pipeline-docker.yml)
      echo "true"
      exit 0
      ;;
    package.json)
      # Root overrides / workspace config affect `npm ci` inside the image.
      echo "true"
      exit 0
      ;;
    package-lock.json)
      lockfile_changed=true
      ;;
  esac
done

if [[ "$lockfile_changed" != "true" ]]; then
  echo "false"
  exit 0
fi

# Lockfile hunks for media-pipeline workspaces, @vmp/* packages, or redis (media-pipeline only).
if git diff "$BASE" "$HEAD" -- package-lock.json | grep -qE \
  'packages/(media-pipeline|storage)(/|")|"@vmp/(media-pipeline|storage)"|node_modules/@vmp/(media-pipeline|storage)|node_modules/redis'; then
  echo "true"
  exit 0
fi

echo "false"
