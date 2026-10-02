# Billing Worker secrets (Phase F ops)

After `@vmp/billing` was extracted (#725), **PSP and auth secrets must exist on the billing Worker**, not only on `@vmp/api`. CD deploys the Worker but does **not** copy secrets.

## Symptoms when secrets are missing

| Symptom | Cause |
|---------|--------|
| `GET /api/account/pricing` → `enabledProviders: []`, `pricing_not_configured: true` | `STRIPE_SECRET_KEY` missing on `vmp-billing` (publishable key alone is not enough) |
| `GET /api/account/subscription` → `401` / `503` `billing_auth_misconfigured` | `JWT_SECRET` missing or not matching the API Worker |
| Checkout / admin payments / promos 401 | Same JWT issue |

## Put secrets (staging = top-level `vmp-billing`)

Use the **same values** already on `@vmp/api`:

```bash
cd packages/billing
npx wrangler secret put JWT_SECRET
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
# optional / as needed:
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put PEPPOL_AP_API_KEY
npx wrangler secret put GOPAY_CLIENT_ID
npx wrangler secret put GOPAY_CLIENT_SECRET
npx wrangler secret put GOPAY_GOID
npx wrangler secret put COMGATE_MERCHANT
npx wrangler secret put COMGATE_SECRET
```

Production Worker `vmp-billing-prod`:

```bash
cd packages/billing
npx wrangler secret put JWT_SECRET --env production
npx wrangler secret put STRIPE_SECRET_KEY --env production
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
# …same for other secrets with --env production
```

## Verify

```bash
curl -sS https://vmp-api.tjm.sk/api/billing/ready | jq .
# expect: ready=true, secrets.JWT_SECRET=true, secrets.STRIPE_SECRET_KEY=true

bash .github/scripts/smoke-billing-ready.sh https://vmp-api.tjm.sk
```

`JWT_SECRET` must be identical on API and billing or tokens issued by auth will fail signature checks on billing routes.
