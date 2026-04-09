# Deployment and Environment Strategy

## Unified environment variables

Use the root `.env.example` as the single source template for all runtime values.

Copy per environment:

- `.env.staging`
- `.env.production`

For local API development, mirror required values into `packages/api/.dev.vars` (never commit secrets).

## Multi-domain setup

Keep domain-specific values as env overrides:

- `FRONTEND_URL`
- `ALLOWED_ORIGINS`
- `R2_BASE_URL`

Deploy each domain with its own Wrangler environment and secret set.

## CI/CD flow

The workflow in `.github/workflows/deploy.yml` uses:

- pushes to `main` -> staging deploy
- version tags (`v*`) -> production deploy

Required repository secrets:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_STAGING_PROJECT`
- `CF_PROD_PROJECT`

