# Web Workers deployment — environment variables

The Nuxt frontend deploys as a Cloudflare Worker (`wrangler.workers.toml`), not Pages.

| Worker name | Wrangler env | When CI deploys |
|---|---|---|
| `vmp-web-worker-dev` | default | push to `main` / staging workflow |
| `vmp-web-worker-prod` | `--env production` | version tag `v*.*.*` / production workflow |

## Build-time (set when running `npm run build` in `packages/web`)

Read in `nuxt.config.ts` via `process.env` and embedded into the client/server bundle.

| Variable | Used for | CI source |
|----------|----------|-----------|
| `API_URL` | `runtimeConfig.public.apiUrl` | `vars.API_URL_STAGING` / `vars.API_URL_PROD` |
| `NUXT_PUBLIC_SITE_URL` | `runtimeConfig.public.siteUrl`, OG URLs | `vars.FRONTEND_URL_STAGING` / `vars.FRONTEND_URL_PROD` |
| `NUXT_PUBLIC_DEPLOY_TIER` | Admin footer build label | `staging` / `production` in `deploy.yml` |
| `NUXT_PUBLIC_GIT_COMMIT` | Admin footer git SHA | `${{ github.sha }}` |
| `NUXT_PUBLIC_APP_VERSION` | Admin footer on production tags | tag name on prod deploy |
| `NUXT_PUBLIC_GTM_ID` | GTM module | optional repo var |
| `NUXT_PUBLIC_SENTRY_DSN` | `@sentry/nuxt` | `vars.NUXT_PUBLIC_SENTRY_DSN` |
| `SENTRY_AUTH_TOKEN` | Source map upload | `secrets.SENTRY_AUTH_TOKEN` |
| `NODE_ENV` | GTM debug flag | `production` in CI |

## Wrangler runtime

No server-only secrets are required for the current Nuxt app. All config used at runtime today is in `runtimeConfig.public` (build-time).

## GitHub Actions secrets (web Worker deploy)

Uses the same environment-scoped tokens as the API Worker:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN_STAGING` / `CLOUDFLARE_API_TOKEN_PROD` | `wrangler deploy` auth |
| `CLOUDFLARE_ACCOUNT_ID_STAGING` / `CLOUDFLARE_ACCOUNT_ID_PROD` | Account routing |

## Custom domains

Attach `vmp.tjm.sk` (or staging hostname) to the **Worker** that should serve traffic (`vmp-web-worker-dev` or `vmp-web-worker-prod`) in the Cloudflare dashboard — not to a Pages project. See AGENTS.md → “When deploy looks broken but CI is green”.
