# VMP (Video Monetization Platform)

VMP is a Cloudflare-based video subscription platform with a Worker API, Nuxt web app, and shared TypeScript types.

## Contents

- [Monorepo packages](#monorepo-packages)
- [Documentation map](#documentation-map)
- [Deployment model (high level)](#deployment-model-high-level)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Manual deploy commands](#manual-deploy-commands)
- [Runtime secrets/vars](#runtime-secretsvars)
  - [Optional MediaConvert pipeline](#optional-mediaconvert-pipeline-additive-to-local-rclone-flow)
- [API docs (`docs/`)](#api-docs-docs)
- [Notes](#notes)

## Monorepo packages

| Package | Path | Role |
| --- | --- | --- |
| `@vmp/api` | [`packages/api`](packages/api) | Cloudflare Worker API + D1/R2/KV integrations |
| `@vmp/web` | [`packages/web`](packages/web) | Nuxt 4 frontend deployed to Cloudflare Pages |
| `@vmp/shared` | [`packages/shared`](packages/shared) | Shared TypeScript contracts |
| `@vmp/api-node` | [`packages/api-node`](packages/api-node) | Deno Deploy backup API (Postgres + S3 adapters) — see [README](packages/api-node/README.md) |
| `@vmp/media-pipeline` | [`packages/media-pipeline`](packages/media-pipeline) | Media VM: SVT Encore transcoding + Shaka HLS + R2 — see [README](packages/media-pipeline/README.md) |
| `@vmp/offloading` | [`packages/offloading`](packages/offloading) | R2↔Garage hot/cold tier orchestration — see [README](packages/offloading/README.md) |
| `@vmp/moq-probe` | [`packages/moq-probe`](packages/moq-probe) | MoQ broadcast diagnostic probe — see [README](packages/moq-probe/README.md) |

Core API and web packages do not ship separate READMEs; see [AGENTS.md](AGENTS.md) for architecture, auth, schema, and local dev.

## Documentation map

| Document | Description |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Canonical agent/dev guide: git workflow, D1 schema, auth, secrets, roadmap |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environment variables, CI/CD, multi-domain deploy |
| [packages/api-node/README.md](packages/api-node/README.md) | Deno Deploy API backup, Postgres replication ingest |
| [packages/media-pipeline/README.md](packages/media-pipeline/README.md) | Encore transcoding orchestration, supervisor, webhooks, TTP logging |
| [packages/media-pipeline/MIGRATION.md](packages/media-pipeline/MIGRATION.md) | Cutover guide from legacy `podcast-host` |
| [packages/media-pipeline/systemd/README.md](packages/media-pipeline/systemd/README.md) | `vmp-supervisor` systemd unit install and ops |
| [packages/offloading/README.md](packages/offloading/README.md) | Garage compose, demote/promote scripts |
| [packages/offloading/DEPLOYMENT.md](packages/offloading/DEPLOYMENT.md) | Docker/Compose deployment for offloading |
| [packages/moq-probe/README.md](packages/moq-probe/README.md) | Live MoQ probe usage and recorder recommendations |
| [.cursor/README.md](.cursor/README.md) | Cursor workspace git/deploy policy for agents |
| [docs/pills-external-update-api.md](docs/pills-external-update-api.md) | Pills external update API |

## Deployment model (high level)

- Pushes to `main` run staging deploy in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): API Worker + web Worker (`vmp-web-worker-dev`).
- Version tags (`v*.*.*`) run production deploy: API Worker + web Worker (`vmp-web-worker-prod`).
- Frontend is **Cloudflare Workers only** (Nuxt SSR). Pages is deprecated.
- Deploy pipeline fails fast on type-checking before build/deploy:
  - `@vmp/shared` `tsc --noEmit`
  - `@vmp/api` `tsc --noEmit`
  - `@vmp/web` `nuxi prepare && nuxi typecheck`

See [DEPLOYMENT.md](DEPLOYMENT.md) for env templates, secrets, and domain overrides.

## Prerequisites

1. Node.js 20+ and npm 10+.
2. Cloudflare account with:
   - Two Workers per environment (API + Nuxt web frontend)
   - D1 database
   - R2 bucket
   - KV namespaces
3. Repository secrets configured for CI deploy:
   - `CLOUDFLARE_API_TOKEN_STAGING`
   - `CLOUDFLARE_ACCOUNT_ID_STAGING`
   - `CLOUDFLARE_API_TOKEN_PROD`
   - `CLOUDFLARE_ACCOUNT_ID_PROD`

## Local setup

1. Install dependencies:
   - `npm ci`
2. Build service worker helper from TS source:
   - `npm run build:sw-push --workspace=@vmp/web`
3. Type-check everything:
   - `npm run typecheck`

Full local dev (API on `:8787`, web on `:3000`, D1 migrations): [AGENTS.md → Cursor Cloud-specific instructions](AGENTS.md#cursor-cloud-specific-instructions).

## Manual deploy commands

These are useful for controlled/manual rollouts outside GitHub Actions.

1. API deploy:
   - `npm run deploy:api`
2. Web deploy (from `packages/web` after `npm run build`):
   - Staging Worker: `npm run deploy --workspace=@vmp/web`
   - Production Worker: `npm run deploy:prod --workspace=@vmp/web`

## Runtime secrets/vars

Use Wrangler secrets for sensitive values (never commit secrets). Required values are documented in [AGENTS.md](AGENTS.md) and [DEPLOYMENT.md](DEPLOYMENT.md) (JWT, Stripe, Brevo, VAPID, RSS, TOTP encryption, etc.).

### Optional MediaConvert pipeline (additive to local rclone flow)

The existing local/watchfolder/rclone pipeline remains the default and is unchanged.  
An optional cloud path can be enabled for direct source uploads + AWS Elemental MediaConvert.

Required API env vars (Worker):

- `MEDIA_CONVERT_ENABLED=1`
- `AWS_REGION` (for S3 + MediaConvert, e.g. `eu-central-1`)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` (optional, only when using temporary credentials)
- `MEDIA_CONVERT_ENDPOINT` (account-specific endpoint from MediaConvert console)
- `MEDIA_CONVERT_ROLE_ARN` (IAM role MediaConvert assumes)
- `MEDIA_CONVERT_INPUT_BUCKET` (S3 source uploads)
- `MEDIA_CONVERT_OUTPUT_BUCKET` (S3 transcode outputs)
- `MEDIA_CONVERT_INPUT_PREFIX` (optional, default `mediaconvert-input`)
- `MEDIA_CONVERT_OUTPUT_PREFIX` (optional, default `mediaconvert-output`)
- `MEDIA_CONVERT_MAX_UPLOAD_MB` (optional, default `4096`)
- `MEDIA_CONVERT_PRICE_HD_PER_MIN` (optional, default `0.015`; rough estimator)

AWS setup checklist:

1. Create/choose two S3 prefixes/buckets for input and output.
2. Create a MediaConvert IAM service role (`MEDIA_CONVERT_ROLE_ARN`) with read access to input and write access to output.
3. Create an IAM principal for the Worker credentials with:
   - `mediaconvert:CreateJob`, `mediaconvert:GetJob`
   - `iam:PassRole` scoped to `MEDIA_CONVERT_ROLE_ARN`
   - `s3:PutObject` on input prefix
   - `s3:GetObject` on output object prefix
   - `s3:ListBucket` on output bucket (bucket-level action), scoped by `s3:prefix` condition to the output prefix
4. In MediaConvert console, copy the account endpoint into `MEDIA_CONVERT_ENDPOINT`.
5. Run migration `packages/api/migrations/0017_media_convert_jobs.sql`.

Notes:

- Current cloud profile is H.264/HLS with 720p only, fps capped at 30.
- Architecture is rendition-based and supports future expansion (480p/1080p/4K, alternate codecs).
- Usage/cost values are approximate normalized-minute estimates, not billing-grade accounting.

## API docs (`docs/`)

- [Pills external update API](docs/pills-external-update-api.md)

## Notes

- API entrypoint is TypeScript (`packages/api/src/index.ts`) referenced by `packages/api/wrangler.json`.
- Worker/service scripts that must remain JavaScript at runtime (for browser/service-worker execution) are generated from TypeScript sources during build.
- Media encoding on a VM is handled by [`@vmp/media-pipeline`](packages/media-pipeline/README.md) (SVT Encore + orchestrator); optional Deno backup API by [`@vmp/api-node`](packages/api-node/README.md).
