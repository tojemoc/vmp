# VMP (Video Monetization Platform)

Subscription-gated HLS video streaming: Cloudflare Worker API + Nuxt 4 web app, with optional Deno backup API and a media VM for transcoding.

## Contents

- [Architecture](#architecture)
- [Monorepo packages](#monorepo-packages)
- [Documentation](#documentation)
- [Prerequisites](#prerequisites)
- [Local development](#local-development)
- [Deploy](#deploy)
- [Secrets and configuration](#secrets-and-configuration)
- [Media encoding](#media-encoding)

## Architecture

| Layer | Technology |
| --- | --- |
| API | Cloudflare Worker (`@vmp/api`) — REST, auth, Stripe, push, RSS |
| Web | Nuxt 4 / Vue 3 (`@vmp/web`) — Cloudflare **Workers** SSR (`vmp-web-worker-dev` / `vmp-web-worker-prod`) |
| Database | Cloudflare D1 (SQLite); Postgres shim on Deno backup |
| Object storage | Cloudflare R2 (pluggable via `@vmp/storage`) |
| Payments | Stripe (+ optional legacy Qerko via `@vmp/payments`) |
| Email / push | Brevo transactional, Web Push (VAPID) |
| Transcoding | `@vmp/media-pipeline` on a media VM (SVT Encore + Shaka → R2) |
| Backup API | `@vmp/api-node` on Deno Deploy (same handlers, Postgres + S3) |

Cloudflare **Pages** (`vmp-fe`) is deprecated. Do not attach production hostnames to Pages.

```text
Browser ──► @vmp/web (Worker SSR)
                │
                ▼
           @vmp/api (Worker) ──► D1 / R2 / KV
                │
                ├── Stripe webhooks, Brevo, Web Push
                └── pipeline-status ◄── @vmp/media-pipeline (VM)
```

## Monorepo packages

| Package | Path | Role |
| --- | --- | --- |
| `@vmp/api` | [`packages/api`](packages/api) | Primary Cloudflare Worker API |
| `@vmp/web` | [`packages/web`](packages/web) | Nuxt 4 frontend (Workers SSR) |
| `@vmp/shared` | [`packages/shared`](packages/shared) | Shared TypeScript types |
| `@vmp/storage` | [`packages/storage`](packages/storage) | Pluggable object storage (R2 / S3-compatible) — [README](packages/storage/README.md) |
| `@vmp/payments` | [`packages/payments`](packages/payments) | Payment provider registry (Stripe, legacy Qerko) — [README](packages/payments/README.md) |
| `@vmp/api-node` | [`packages/api-node`](packages/api-node) | Deno Deploy backup API — [README](packages/api-node/README.md) |
| `@vmp/media-pipeline` | [`packages/media-pipeline`](packages/media-pipeline) | Media VM: Encore + Shaka HLS + R2 — [README](packages/media-pipeline/README.md) |
| `@vmp/offloading` | [`packages/offloading`](packages/offloading) | R2 ↔ Garage hot/cold tiering — [README](packages/offloading/README.md) |
| `@vmp/moq-probe` | [`packages/moq-probe`](packages/moq-probe) | MoQ live broadcast diagnostic probe — [README](packages/moq-probe/README.md) |
| `@vmp/mobile` (PoC) | [`apps/mobile`](apps/mobile) | Expo Tier 1 client — not a root workspace member yet; see [native-clients plan](docs/native-clients-plan.md) |

Core API/web packages do not ship separate READMEs; see [AGENTS.md](AGENTS.md) for auth, D1 schema, roles, and agent workflow.

## Documentation

| Document | Audience |
| --- | --- |
| [AGENTS.md](AGENTS.md) | **Canonical** architecture, git workflow, secrets, local Cloud setup, roadmap |
| [DEPLOYMENT.md](DEPLOYMENT.md) | CI/CD, env vars, smoke checks, bootstrap / rollback |
| [docs/README.md](docs/README.md) | Index of API notes and historical design docs |
| [docs/native-clients-plan.md](docs/native-clients-plan.md) | Multi-tier native/TV clients (Expo → TV → Tizen/webOS) |
| [packages/web/docs/workers-deploy-env.md](packages/web/docs/workers-deploy-env.md) | Web Worker build-time env vars |
| Package READMEs under `packages/*` | Package-specific ops (pipeline, api-node, storage, …) |

## Prerequisites

1. Node.js 20+ and npm 10+ (`packageManager` in root `package.json`).
2. Cloudflare account with Workers, D1, R2, and KV (per environment).
3. CI deploy secrets: `CLOUDFLARE_API_TOKEN_{STAGING,PROD}` and `CLOUDFLARE_ACCOUNT_ID_{STAGING,PROD}`.

## Local development

```bash
npm ci
npm run typecheck

# API (Wrangler, port 8787) — needs packages/api/.dev.vars
npm run dev --workspace=@vmp/api

# Web (Nuxt, port 3000)
API_URL=http://localhost:8787 npm run dev --workspace=@vmp/web
```

Apply D1 migrations locally before serving data:

```bash
cd packages/api
for f in $(ls -1 migrations/*.sql | sort); do
  npx wrangler d1 execute video-subscription-db --local --file="$f"
done
```

Seed videos start as drafts. To publish them for the homepage:

```bash
npx wrangler d1 execute video-subscription-db --local \
  --command="UPDATE videos SET publish_status = 'published', published_at = CURRENT_TIMESTAMP WHERE publish_status = 'draft';"
```

Full Cloud-agent local notes (secrets, gotchas): [AGENTS.md → Cursor Cloud-specific instructions](AGENTS.md#cursor-cloud-specific-instructions).

## Deploy

| Trigger | What deploys |
| --- | --- |
| Push to `main` | Staging: API Worker + web Worker (`vmp-web-worker-dev`) via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) |
| Tag `v*.*.*` | Production: API Worker + web Worker (`vmp-web-worker-prod`) |
| Push / PR (Deno git integration) | `@vmp/api-node` preview/production build on Deno Deploy — **not** from `deploy.yml`. PR check status is **pending until** `deploy/tjm/vmp` clears; maintainer log review on [console.deno.com](https://console.deno.com) is required when that check stays red. |

Manual commands:

```bash
npm run deploy:api
npm run deploy --workspace=@vmp/web          # staging Worker
npm run deploy:prod --workspace=@vmp/web     # production Worker
```

Deploy gates typecheck `@vmp/shared`, `@vmp/storage`, `@vmp/api`, and `@vmp/web` before build. Details: [DEPLOYMENT.md](DEPLOYMENT.md).

**Never push feature work directly to `main`** — use a branch + pull request (autodeploy + CodeRabbit). See [AGENTS.md → Git workflow](AGENTS.md#git-workflow-mandatory--read-first).

## Secrets and configuration

- Template: root [`.env.example`](.env.example). Copy to `.env.staging` / `.env.production` as needed.
- Local API secrets: `packages/api/.dev.vars` (never commit).
- Required Worker secrets (JWT, Stripe, Brevo, VAPID, RSS, TOTP, …): listed in [AGENTS.md](AGENTS.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
- Prices, plan names, and limits live in D1 `admin_settings` — not hardcoded.

## Media encoding

Transcoding runs on a **media VM** via [`@vmp/media-pipeline`](packages/media-pipeline/README.md):

1. Watchfolder intake → SVT Encore encode
2. encore-packager (Shaka) → fMP4 HLS ladder uploaded to R2
3. HMAC callback to `POST /api/admin/videos/:id/pipeline-status`

There is **no** AWS Elemental MediaConvert admin upload/transcode UI in this repo anymore. The historical `media_convert_jobs` D1 table remains: playback and offline-download code may still read completed **Bunny Stream** rows (`provider = 'bunnystream'`, `bunny_playback_url`) as an alternate HLS entrypoint. Do not drop that table without a migration that replaces those reads.
