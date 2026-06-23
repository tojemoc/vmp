#!/usr/bin/env bash
# Write ORT global config for SCANOSS snippet scanning on the self-hosted runner.
set -euo pipefail

ORT_CONFIG_DIR="${ORT_CONFIG_DIR:-$HOME/.ort/config}"
mkdir -p "$ORT_CONFIG_DIR"

if [[ ! -d "$ORT_CONFIG_DIR/.git" ]]; then
  git clone --depth 1 https://github.com/oss-review-toolkit/ort-config.git "$ORT_CONFIG_DIR"
fi

if [[ -n "${SCANOSS_API_KEY:-}" ]]; then
  secrets_block="        secrets:
          apiKey: '${SCANOSS_API_KEY}'"
else
  # OSSKB (api.osskb.org) works without a key; omit empty apiKey (causes HTTP 400).
  secrets_block=""
fi

cat > "$ORT_CONFIG_DIR/config.yml" <<EOF
ort:
  scanner:
    config:
      SCANOSS:
        options:
          apiUrl: 'https://api.osskb.org/'
          writeToStorage: true
          enablePathObfuscation: false
          minSnippetHits: 3
          minSnippetLines: 5
          honourFileExts: true
          rankingEnabled: true
          rankingThreshold: 90
          skipHeaders: false
          skipHeadersLimit: 0
${secrets_block}
EOF

echo "ORT config written to $ORT_CONFIG_DIR/config.yml"
