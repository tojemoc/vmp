#!/usr/bin/env bash
# Idempotent CodeRabbit CLI bootstrap for Cursor Cloud Agent environments.
# Docs: https://docs.coderabbit.ai/cli/overview
set -euo pipefail

export PATH="${HOME}/.local/bin:${PATH}"

if ! command -v coderabbit >/dev/null 2>&1; then
  # CI=1 skips the interactive post-install browser login prompt.
  # CODERABBIT_API_KEY (when set) also skips that prompt; we auth explicitly below.
  CI=1 curl -fsSL https://cli.coderabbit.ai/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
fi

if [[ -n "${CODERABBIT_API_KEY:-}" ]]; then
  auth_args=(--api-key "${CODERABBIT_API_KEY}")
  if [[ -n "${CODERABBIT_REGION:-}" ]]; then
    auth_args+=(--region "${CODERABBIT_REGION}")
  fi
  coderabbit auth login "${auth_args[@]}"
fi

coderabbit --version
