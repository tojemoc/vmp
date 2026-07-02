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

Canonical deploy workflow: `.github/workflows/deploy.yml`.

`deploy.yml` is the only supported deployment workflow.

The canonical workflow uses:

- pushes to `main` → staging API Worker (`@vmp/api`) + staging web Worker (`vmp-web-worker-dev`)
- version tags (`v*.*.*`) → production API Worker + production web Worker (`vmp-web-worker-prod`)

**Deno Deploy backup API (`@vmp/api-node`)** is **not** deployed from `deploy.yml`. Deno Deploy builds and deploys automatically from the linked GitHub repository on every push (including PR preview builds). CLI uploads via `deno deploy` from GitHub Actions have been observed to fail consistently while git-triggered builds succeed; rely on the Deno Deploy build status on the pull request and in [console.deno.com](https://console.deno.com) instead.

Frontend deploy is **Workers only** (Nuxt `cloudflare-module` preset). Cloudflare Pages is deprecated in this repo.

### Deno Deploy backup API (`@vmp/api-node`) — verify and deploy gates

The backup API runs the same `@vmp/api` handlers on Deno Deploy with a Postgres D1 shim.

**Pull requests (`.github/workflows/ci.yml`, job `api-node`):**

- `npm run verify:api-node` — typecheck, unit tests (including Sentry/D1 shim compatibility), and esbuild bundle.
- **A PR that fails this job must not be merged** if branch protection requires CI green.

**Deno Deploy (git integration — not `deploy.yml`):**

- Deno Deploy automatically builds and deploys from the linked repository on every push. PRs get preview deployments; merges to `main` update production.
- **Check the Deno Deploy build status on the PR** (and preview URL in [console.deno.com](https://console.deno.com)) before merging api-node changes. Git-triggered builds are the source of truth; `deno deploy` CLI uploads from CI are not used.
- Optional manual smoke after a production deploy (when `vars.API_URL_BACKUP` is set): `.github/scripts/smoke-api-node-backup.sh` checks:
  - `GET /api/health` — `mode: "deno-deploy"`, database check `ok: true`
  - `GET /api/homepage/content` — HTTP 200 (catches runtime DB/Sentry shim failures that build alone would miss)

Required for Deno backup API runtime (set in Deno Deploy dashboard, not GitHub Actions deploy):

- `DATABASE_URL` (managed Postgres)
- Worker-equivalent secrets (see `packages/api-node/.env.example`)
- Optional variable for manual smoke: `API_URL_BACKUP` (public backup API origin, e.g. `https://vmp-backup-api.tjm.sk`)

Local parity before opening a PR:

```bash
npm run verify:api-node
```

See [`packages/api-node/README.md`](packages/api-node/README.md) for runtime setup and replication ingest.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN_STAGING`
- `CLOUDFLARE_API_TOKEN_PROD`
- `CLOUDFLARE_ACCOUNT_ID_STAGING`
- `CLOUDFLARE_ACCOUNT_ID_PROD`
- `STAGING_SMOKE_AUTH_TOKEN` (shared secret for staging `/api/admin/smoke-auth` smoke check)
- `PROD_SMOKE_AUTH_TOKEN` (shared secret for production `/api/admin/smoke-auth` smoke check)

Note: the deploy workflow reads these exact `CLOUDFLARE_*_STAGING/PROD` secret names.

Required environment variables (GitHub Environments/Repository Variables):

- Staging:
  - `API_URL_STAGING`
  - `FRONTEND_URL_STAGING` (must match the Worker custom domain or `*.workers.dev` URL you route to `vmp-web-worker-dev`)
  - `ALLOWED_ORIGINS_STAGING`
  - `NUXT_PUBLIC_SENTRY_DSN` (frontend Sentry project DSN, embedded at build time)
- Production:
  - `API_URL_PROD`
  - `FRONTEND_URL_PROD` (custom domain routed to `vmp-web-worker-prod`)
  - `ALLOWED_ORIGINS_PROD`
  - `NUXT_PUBLIC_SENTRY_DSN` (frontend Sentry project DSN, embedded at build time)

Optional repository secret for Sentry source map uploads during web builds:

- `SENTRY_AUTH_TOKEN` (org token with `project:releases` + `org:read`)

The hardened workflows now enforce:

- API and web builds use the environment-specific `API_URL_*`.
- Deploy steps use environment-specific Cloudflare token/account secrets.
- Post-deploy smoke checks validate:
  - `/api/health` payload (`{ status: "healthy" }`)
  - CORS `Access-Control-Allow-Origin` against `FRONTEND_URL_*`
  - machine smoke-auth endpoint (`GET /api/admin/smoke-auth`) via `X-Smoke-Token`
  - frontend reachability on `FRONTEND_URL_*`
  - `gitCommit` baked into deployed HTML matches `${{ github.sha }}` (see `.github/scripts/smoke-frontend-build-revision.sh`)

Smoke auth endpoint details:

- Route: `GET /api/admin/smoke-auth`
- Header: `X-Smoke-Token: <token>`
- Secrets used by workflow:
  - Worker env secrets: `SMOKE_AUTH_TOKEN_STAGING` / `SMOKE_AUTH_TOKEN_PROD`
  - GitHub Action secrets: `STAGING_SMOKE_AUTH_TOKEN` / `PROD_SMOKE_AUTH_TOKEN`
- Token must match exactly (timing-safe compare); use a long random value and rotate as needed.

## Fresh infrastructure bootstrap runbook

Use this when staging/production D1, KV, and/or R2 were intentionally reset.

1) Freeze auto-deploys

- Confirm `.github/workflows/deploy.yml` is the only active deployment workflow (no separate Pages or experimental web workflow).

1. Recreate bindings/resources (per environment)

- D1 database
- KV namespace(s)
- R2 bucket(s)
- Update Worker/Page bindings to point to recreated resources.

1. Restore required secrets (per environment)

- `JWT_SECRET`
- `BREVO_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TOTP_ENCRYPTION_KEY`
- `VAPID_PRIVATE_KEY`
- `RSS_SECRET`
- `SENTRY_DSN` (Worker API project DSN for `@sentry/cloudflare`)

1. Re-apply database migrations in order

- Run all SQL files in `packages/api/migrations/` in ascending order.
- Do not edit historical migration files; add new numbered migrations as needed.

### Migration safety closure + regression gates

Run these commands after migrations and before promoting traffic:

1) Idempotent backfill/mapping script

- Local dry-run style check:
  - `npm run db:migration-backfill --workspace=@vmp/api`
- Remote target:
  - `DB_NAME=video-subscription-db npm run db:migration-backfill --workspace=@vmp/api -- --remote`
- Expected success signal:
  - Output includes `[backfill] Completed successfully.`
  - Re-running should produce the same success output with no errors.
- Failure interpretation:
  - Any non-zero exit means schema drift (missing columns/tables) or DB connectivity issues.
  - Resolve schema mismatch first, then rerun migrations and this backfill.

2) Integrity verification script (hard PASS/FAIL gate)

- Local:
  - `npm run db:migration-verify --workspace=@vmp/api`
- Remote:
  - `DB_NAME=video-subscription-db npm run db:migration-verify --workspace=@vmp/api -- --remote`
- Expected PASS output:
  - Row counts emitted for key tables.
  - Final line: `[verify] PASS: all integrity checks are zero.`
- Expected FAIL output:
  - Integrity failures: Final line `[verify] FAIL: <n> integrity check(s) are non-zero.` — command exits `1`; deployment should stop until non-zero checks are fixed.
  - Schema failures: Final line `[verify] FAIL: <n> required schema check(s) missing.` — command exits `1`; deployment should stop until schema drift is resolved.
  - Operators should look for either failure message when triaging verification issues.

3) Targeted deterministic regression suite (Task 12)

- `npm test --workspace=@vmp/api -- --test-name-pattern="clampNewsletterPollIntervalMs|isNewsletterSendFinished|fetchBrevoEmailCampaignsWithRetry|evaluateRoleChange|evaluateSelfRoleChange|evaluateSubscriptionStatusChange|segment analytics|normalizeLivestreamStatus|normalizeStripeStatus|placeHomepageVideos matrix|sortCategoriesForHomepage|placementTimestampMs"`
- Expected PASS signal:
  - Node test runner summary reports all listed suites passing, zero failed tests.
- Failure interpretation:
  - Any failing suite blocks deployment; fix regression and rerun full targeted command.

1. Seed data policy

- Staging: seed freely for smoke testing.
- Production: seed only intentional baseline config; avoid test/demo data.

1. Deploy order

- Deploy API first.
- Deploy web second.

1. Post-deploy smoke checks

- `GET /api/health` returns healthy.
- Auth flow (magic link + session restore) works.
- Admin loads and can perform one write action.
- Homepage and watch routes render without server errors.
- If media was reset, validate expected behavior for missing/placeholder media.

## Rollback notes (staging/production)

Use the smallest rollback that restores service:

1. Full rollback
- Re-run `.github/workflows/deploy.yml` from a known-good commit/tag (`workflow_dispatch`) targeting the affected environment.
- Validate health, CORS, admin auth smoke checks, and homepage/watch rendering.

2. Emergency containment
- If staging deploy is unstable, pause merges to `main` until smoke checks are green.
- If production deploy is unstable, disable further production tags and roll back first, then investigate.

## Livestream notes (Media over QUIC)

- Livestream entries are standard `videos` rows plus a `livestreams` metadata row (`provider = moq`).
- Admins create livestreams from **Admin → Videos → Create new livestream**, supplying MoQ endpoint URL and broadcast name (no hardcoded URLs in code).
- Playback runs in `/watch/:videoId` via `@moq/watch` when `moq_endpoint` and `moq_broadcast` are set.
- After a stream ends, attach a recorded VOD via `recording_video_id` on the livestream row (or swap in admin) so `/watch/:videoId` serves the uploaded HLS asset.