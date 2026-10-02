#!/usr/bin/env bash
# Post-deploy smoke: billing Worker secrets + public pricing providers.
# Usage: smoke-billing-ready.sh <api-base-url>
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "usage: smoke-billing-ready.sh <api-base-url>" >&2
  exit 2
fi

base_url="${1%/}"
ready_url="${base_url}/api/billing/ready"
pricing_url="${base_url}/api/account/pricing"

echo "Checking billing readiness at ${ready_url}" >&2
ready_status="$(curl -sS -o /tmp/smoke-billing-ready.json -w "%{http_code}" "$ready_url" || true)"
if [ "$ready_status" = "404" ]; then
  echo "Billing readiness route missing (HTTP 404). Deploy @vmp/api + @vmp/billing with /api/billing/ready support." >&2
  cat /tmp/smoke-billing-ready.json >&2 || true
  exit 1
fi
if [ "$ready_status" != "200" ]; then
  echo "Billing readiness check failed with HTTP ${ready_status}" >&2
  cat /tmp/smoke-billing-ready.json >&2 || true
  echo >&2
  echo "Phase F ops: copy secrets onto the billing Worker (same values as @vmp/api):" >&2
  echo "  cd packages/billing" >&2
  echo "  npx wrangler secret put JWT_SECRET" >&2
  echo "  npx wrangler secret put STRIPE_SECRET_KEY" >&2
  echo "  npx wrangler secret put STRIPE_WEBHOOK_SECRET" >&2
  echo "  # staging uses top-level Worker; production: add --env production" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync("/tmp/smoke-billing-ready.json", "utf8"));
if (body?.service !== "vmp-billing" || body?.ready !== true) {
  console.error("Billing readiness payload invalid", body);
  process.exit(1);
}
if (
  !body.secrets?.JWT_SECRET ||
  !body.secrets?.STRIPE_SECRET_KEY ||
  !body.secrets?.STRIPE_WEBHOOK_SECRET ||
  !body.secrets?.STRIPE_PUBLISHABLE_KEY ||
  body.providers?.stripePublishableConfigured !== true
) {
  console.error(
    "Required billing secrets missing",
    body.missingRequired,
    body.secrets,
    body.providers,
  );
  process.exit(1);
}
console.log("Billing readiness OK");
'

echo "Checking public pricing at ${pricing_url}" >&2
pricing_status="$(curl -sS -o /tmp/smoke-billing-pricing.json -w "%{http_code}" "$pricing_url" || true)"
if [ "$pricing_status" != "200" ]; then
  echo "Pricing smoke failed with HTTP ${pricing_status}" >&2
  cat /tmp/smoke-billing-pricing.json >&2 || true
  exit 1
fi

node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync("/tmp/smoke-billing-pricing.json", "utf8"));
const providers = Array.isArray(body.enabledProviders) ? body.enabledProviders : [];
if (providers.length === 0 || body.pricing_not_configured === true) {
  console.error(
    "Pricing has no runnable providers. Put STRIPE_SECRET_KEY on vmp-billing (and ensure payments_enabled_providers includes stripe).",
    { enabledProviders: providers, pricing_not_configured: body.pricing_not_configured, stripeConfigured: body.stripeConfigured },
  );
  process.exit(1);
}
if (!providers.includes("stripe") && body.stripeConfigured !== true) {
  console.error("Stripe not runnable on billing Worker", body);
  process.exit(1);
}
console.log("Pricing providers OK:", providers.join(","));
'
