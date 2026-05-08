# VMP (Video Monetization Platform)

VMP is a Cloudflare-based video subscription platform with a Worker API, Nuxt web app, and shared TypeScript types.

## Monorepo packages

- `@vmp/api` (`packages/api`) — Cloudflare Worker API + D1/R2/KV integrations.
- `@vmp/web` (`packages/web`) — Nuxt 4 frontend deployed to Cloudflare Pages.
- `@vmp/shared` (`packages/shared`) — shared TypeScript contracts.
- `@vmp/podcast-host` (`packages/podcast-host`) — Node TypeScript media pipeline/supervisor for video processing and podcast preview jobs.
- `@vmp/offloading` (`packages/offloading`) — Node TypeScript offloading service for R2↔Garage hot/cold tier orchestration.

## Deployment model (high level)

- Pushes to `main` run staging deploy in `.github/workflows/deploy.yml`.
- Version tags (`v*.*.*`) run production deploy in `.github/workflows/deploy.yml`.
- Deploy pipeline fails fast on type-checking before build/deploy:
  - `@vmp/shared` `tsc --noEmit`
  - `@vmp/api` `tsc --noEmit`
  - `@vmp/web` `nuxi prepare && nuxi typecheck`

## Prerequisites

1. Node.js 20+ and npm 10+.
2. Cloudflare account with:
   - Worker/API service
   - Pages project(s)
   - D1 database
   - R2 bucket
   - KV namespaces
3. Repository secrets configured for CI deploy:
   - `CLOUDFLARE_API_TOKEN_STAGING`
   - `CLOUDFLARE_ACCOUNT_ID_STAGING`
   - `CLOUDFLARE_API_TOKEN_PROD`
   - `CLOUDFLARE_ACCOUNT_ID_PROD`
   - `CF_PAGES_PROJECT_NAME` (staging web deploy)

## Local setup

1. Install dependencies:
   - `npm ci`
2. Build service worker helper from TS source:
   - `npm run build:sw-push --workspace=@vmp/web`
3. Type-check everything:
   - `npm run typecheck`

## Manual deploy commands

These are useful for controlled/manual rollouts outside GitHub Actions.

1. API deploy:
   - `npm run deploy:api`
2. Web deploy:
   - `npm run deploy:web`

## Runtime secrets/vars

Use Wrangler secrets for sensitive values (never commit secrets). Required values are documented in `AGENTS.md` and `DEPLOYMENT.md` (JWT, Stripe, Brevo, VAPID, RSS, TOTP encryption, etc.).

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
   - `s3:PutObject` on input prefix
   - `s3:GetObject`, `s3:ListBucket` on output prefix
4. In MediaConvert console, copy the account endpoint into `MEDIA_CONVERT_ENDPOINT`.
5. Run migration `packages/api/migrations/0017_media_convert_jobs.sql`.

Notes:
- Current cloud profile is H.264/HLS with 720p only, fps capped at 30.
- Architecture is rendition-based and supports future expansion (480p/1080p/4K, alternate codecs).
- Usage/cost values are approximate normalized-minute estimates, not billing-grade accounting.

## Notes

- API entrypoint is TypeScript (`packages/api/src/index.ts`) referenced by `packages/api/wrangler.json`.
- Worker/service scripts that must remain JavaScript at runtime (for browser/service-worker execution) are generated from TypeScript sources during build.
