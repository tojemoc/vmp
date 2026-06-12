# Web Workers deployment — environment variables

Experimental parallel deploy to Cloudflare Workers (`vmp-web-worker-dev`). Production Pages deploy is unchanged.

## Build-time (must be set when running `npm run build:workers`)

These are read in `nuxt.config.ts` via `process.env` and embedded into the client/server bundle.

| Variable | Used for | Pages CI today | Workers CI (`deploy-web-workers.yml`) |
|----------|----------|----------------|-------------------------------------|
| `API_URL` | `runtimeConfig.public.apiUrl` | `vars.API_URL_STAGING` / prod via `deploy.yml` | `vars.API_URL_STAGING` on `main` |
| `NUXT_PUBLIC_SITE_URL` | `runtimeConfig.public.siteUrl` | Not set (defaults to `https://vmp.tjm.sk`) | Not set — **document gap** |
| `NUXT_PUBLIC_GTM_ID` | GTM module + `runtimeConfig.public.gtm.id` | Not set (default in config) | Not set |
| `NUXT_PUBLIC_SENTRY_DSN` | `runtimeConfig.public.sentry.dsn` (`@sentry/nuxt`) | Not set (Sentry disabled) | `vars.NUXT_PUBLIC_SENTRY_DSN` |
| `SENTRY_AUTH_TOKEN` | Source map upload during build | Not set | `secrets.SENTRY_AUTH_TOKEN` |
| `NODE_ENV` | GTM debug flag | `production` in CI | `production` in CI |

## Wrangler `[vars]` / secrets (runtime on Worker)

No server-only secrets are required for the current Nuxt app. All config used at runtime today is in `runtimeConfig.public` (build-time).

If you later add private `runtimeConfig` keys, map them via Wrangler `[vars]` or `wrangler secret put` — not documented here until needed.

## GitHub Actions secrets (Workers workflow only)

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` auth |
| `CLOUDFLARE_ACCOUNT_ID` | Account routing |

These secrets are for the Workers workflow only — do not reuse Pages project tokens or Pages automation secrets for Workers deployments.

## Missing / parity gaps (not fixed in this experiment)

1. **`NUXT_PUBLIC_SITE_URL`** — Workers preview will emit OG URLs for `https://vmp.tjm.sk` unless set at build time to the `*.workers.dev` origin (or a staging hostname).
2. **API CORS** — API `ALLOWED_ORIGINS` must include the Workers `*.workers.dev` URL if you test auth/API from the experimental host.
3. **PWA / magic links** — `start_url`, manifest, and email links assume the canonical Pages domain unless `NUXT_PUBLIC_SITE_URL` is overridden per environment.
