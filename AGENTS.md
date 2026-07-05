# AGENTS.md

## Git workflow (mandatory — read first)

**Never push commits directly to `main`.** Pushes to `main` trigger **autodeploy** (staging CD via `.github/workflows/deploy.yml`). The maintainer reviews every change with **CodeRabbit** on pull requests before merge.

### Required flow for every code change

1. Create a **feature branch** from `main` (e.g. `fix/…`, `chore/…`, `feat/…`).
2. Commit on that branch only.
3. Push the branch: `git push -u origin <branch>`.
4. Open a **pull request** (draft is fine) targeting `main` — use the PR tooling; do **not** merge locally unless asked.
5. Wait for human review / CodeRabbit; do **not** bypass by pushing to `main`.

### Forbidden

- `git push origin main` (or any direct update to `main` / default branch)
- Committing on `main` in cloud/background sessions when the task is feature work
- Force-pushing `main`

### Allowed without a PR

- None for agents/automation — **always use a PR**, even for docs-only or one-line fixes.

If you are unsure which branch you are on, run `git branch --show-current` before `git push`.

## When deploy looks broken but CI is green

Agents implement what the repo and workflows say. **Stale or split traffic is often a Cloudflare / GitHub configuration issue on the maintainer side**, not a bad merge or a “missed” code deploy.

Before assuming the latest PR failed to ship, check:

1. **Which Worker serves the hostname you are testing?**
   - API: `@vmp/api` Worker (see `packages/api/wrangler.json`).
   - Web: `vmp-web-worker-dev` (staging / `main`) or `vmp-web-worker-prod` (tags), **not** Cloudflare Pages (`vmp-fe` is deprecated).
   - In Cloudflare dashboard → **Workers & Pages** → each Worker → **Settings → Domains & routes**. A custom domain (e.g. `vmp.tjm.sk`) must point at the Worker CI actually deploys to.

2. **Two deploy paths for the same hostname**
   - Historically, an experimental **web Worker** (`deploy-web-workers.yml`) could run in parallel with **Pages** (`deploy.yml`). Disabling the GitHub workflow does **not** remove Worker routes or custom domains already attached in Cloudflare — traffic can still hit an old Worker build.

3. **Compare live revision to `main`**
   - Fetch `/login` and inspect `window.__NUXT__.config` in page source: `gitCommit`, `buildId`, `deployTier`.
   - Or run: `bash .github/scripts/smoke-frontend-build-revision.sh https://your-frontend-url`
   - If `gitCommit` ≠ latest `main` SHA, the URL you are opening is not the deployment CI just updated.

4. **GitHub Actions workflow state**
   - `gh workflow list --repo tojemoc/vmp` — `state: active` vs `disabled_manually`.
   - Only `.github/workflows/deploy.yml` should deploy production traffic.

5. **PWA / service worker**
   - Installed PWA clients can keep old JS chunks until refresh or chunk-load recovery. Test in a fresh profile or with the PWA uninstalled when verifying admin UI changes.

6. **When to change code vs ops**
   - **Ops / config:** wrong Worker route, disabled workflow but live route, Pages domain still attached, `FRONTEND_URL_*` mismatch with actual hostname.
   - **Code / CI:** smoke checks fail, `/admin` 500 on the **correct** hostname after a green deploy, missing features on the URL whose `gitCommit` matches `main`.

Document what you ruled out in PR comments so reviewers do not chase the wrong deploy target.

## Project overview

VMP (Video Monetization Platform) is a subscription-gated HLS video streaming platform. npm workspaces monorepo with three packages:

| Package | Path | Runtime |
|---|---|---|
| `@vmp/api` | `packages/api` | Cloudflare Worker (JS) — REST API, auth, Stripe, push, thumbnails |
| `@vmp/web` | `packages/web` | Nuxt 4 / Vue 3 frontend (TypeScript) — Cloudflare **Worker** SSR (`wrangler.workers.toml`) |
| `@vmp/shared` | `packages/shared` | Shared TS types |

### Infrastructure

| Concern | Service |
|---|---|
| Video/asset storage | Cloudflare R2 |
| API + auth backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Config format | `wrangler.json` (not `.toml`) |
| Frontend | Nuxt 4 on Cloudflare Workers (`vmp-web-worker-dev` / `vmp-web-worker-prod`) + `@vmp/api` API Worker |
| Email | Brevo Transactional API |
| Payments | Stripe (card, PayPal, SEPA via Checkout); optional legacy provider for grandfathered subs |
| Push notifications | Web Push / VAPID |

### Roles

```text
super_admin  — full permissions including promoting/demoting other admins
admin        — everything except editing super_admin accounts
editor       — video CRUD, change visibility/status
analyst      — read-only analytics (future)
moderator    — comment moderation (future)
viewer       — default for all registered users
```

### D1 schema (key tables)

- `users` — id, email, role, totp_secret, totp_enabled
- `videos` — id, title, description, thumbnail_url, full_duration, preview_duration, upload_date, publish_status, published_at, slug
- `subscriptions` — user_id, plan_type (monthly/yearly/club), status, stripe_subscription_id, stripe_customer_id, current_period_end
- `magic_link_tokens` — user_id, token_hash, expires_at, used_at
- `refresh_tokens` — user_id, token_hash, expires_at
- `admin_settings` — key/value store for configurable limits, prices, etc.
- `push_subscriptions` — user_id, endpoint, p256dh, auth

Migrations live in `packages/api/migrations/` — always add a new numbered file, never edit existing ones.

### Auth system (DO NOT rewrite)

Fully implemented in `packages/api/src/auth.js`. Key exports:
- `handleRequestMagicLink` — `POST /api/auth/magic-link`
- `handleVerifyMagicLink` — `GET /api/auth/verify?token=`
- `handleRefreshToken` — `POST /api/auth/refresh`
- `handleLogout` — `POST /api/auth/logout`
- `handleGetMe` — `GET /api/auth/me`
- `handleTotpSetup/Confirm/Verify` — 2FA endpoints
- `requireAuth(request, env)` — throws if no valid Bearer JWT
- `requireRole(request, env, ...roles)` — throws if role not in list

Frontend auth: `packages/web/composables/useAuth.ts` — singleton composable with `user`, `accessToken`, `isLoggedIn`, `isPremium`, `canEditContent`, `isAdmin`, `authHeader()`, etc. Session restored on boot by `plugins/auth.client.ts`. Admin routes guarded by `middleware/admin.ts`.

### Video access flow

1. Frontend calls `GET /api/video-access/{userId}/{videoId}`
2. Worker checks subscription in D1
3. Returns `hasAccess`, `playlistUrl` (proxied through `/api/video-proxy/`)
4. Anonymous users pass `userId = 'anonymous'` — preview only
5. Proxy worker rewrites HLS manifests to truncate at `previewDuration` for non-subscribers

### Pricing (stored in `admin_settings`, not hardcoded)

All prices, limits, and plan names are configurable via `admin_settings` in D1. Key settings: `stripe_price_monthly`, `stripe_price_yearly`, `stripe_price_club`, `rate_limit_anon`.

### General implementation rules

- **Every protected API endpoint** must use `requireAuth` or `requireRole`. Never trust client-supplied userId — always read from the JWT payload.
- **No hardcoded prices, limits, or plan names** — read from `admin_settings`.
- **All admin API calls from the frontend** must include `...authHeader()` from `useAuth()`.
- **CORS**: `buildCorsHeaders` in `index.js` handles credentialed vs public CORS. Don't bypass it.
- **Error format**: all API errors return `{ error: string, code?: string }`.
- **Secrets**: never commit secrets. Use `wrangler secret put` for sensitive values. Local dev secrets go in `packages/api/.dev.vars`.
- **TypeScript in `@vmp/web`**: all new composables and pages should be `.ts` / `<script setup lang="ts">` with explicit prop and emit types.
- **Light/dark text colors (`@vmp/web`)**: the app uses `@nuxtjs/color-mode`. Every visible label, button, link, and body text must set **both** light- and dark-theme Tailwind text (and background/border when needed) utilities — never rely on the browser default (black on dark backgrounds, white on light). Pairings used elsewhere in admin:
  - Primary body: `text-gray-900 dark:text-white`
  - Secondary/muted body: `text-gray-600 dark:text-gray-400` or `text-gray-700 dark:text-gray-300`
  - Secondary outline button: `text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800`
  - File inputs: add `text-gray-900 dark:text-gray-100` plus `file:` variant colors for the picker label
  If you add a new control type, grep admin components for an existing pattern and match it — border-only buttons without `text-*` / `dark:text-*` are a common regression.
- **SubtleCrypto over npm for crypto**: Workers have full WebCrypto. Don't add `crypto`, `jsonwebtoken`, `otplib`, `web-push` as Worker dependencies. Implement with SubtleCrypto directly.
- **Prefer existing modules and dependencies** — Before writing custom infrastructure (plugins, wrappers, integrations), check whether the repo or ecosystem already ships a maintained solution:
  - **Nuxt / frontend:** search [Nuxt Modules](https://nuxt.com/modules) and `packages/web/package.json` dependencies (e.g. `@vite-pwa/nuxt`, `@nuxtjs/color-mode`). Use an official or well-maintained module when it covers the requirement.
  - **Cloudflare Workers:** prefer platform bindings (D1, R2, Queues, KV, DO) and documented patterns over reimplementing queues, caches, or schedulers in raw JS.
  - **Monorepo:** reuse `@vmp/shared` types and existing API helpers; do not duplicate contracts.
  - **When to roll your own:** only when no suitable module exists, the dependency is unmaintained/incompatible (verify on target Nuxt/Worker version), or the requirement is trivially small (a few lines) and a module would add more complexity than value.
  - **Process:** grep the codebase and `package.json` files first; cite the chosen module in the PR description. Example: GTM via `@saslavik/nuxt-gtm`, not a custom `plugins/gtm.client.ts`.
- **PRs**: one PR per step; **never push to `main`** (see [Git workflow](#git-workflow-mandatory--read-first)). PR description should list every file changed and why.
- **Deno Deploy backup API (`@vmp/api-node`)**: PR CI job `api-node` runs `npm run verify:api-node` (typecheck, tests, build). Actual Deno Deploy happens via Deno’s linked-repo git integration (preview on PRs, production on `main`) — **not** from `deploy.yml`. Check the Deno Deploy build status on the PR before merging api-node changes. Optional post-deploy smoke: `.github/scripts/smoke-api-node-backup.sh` against `API_URL_BACKUP`.
- **Before writing code for a step**: read all files that will be modified, check if migrations already exist, confirm API contract before implementing, implement API first then frontend, smoke-test with `wrangler dev`.
- **`package-lock.json`**: never edit the lockfile by hand. Whenever you change dependency versions in any `package.json`, run `npm install` at the repo root so the lockfile is regenerated in sync — CI uses `npm ci`, which fails if the lockfile does not match `package.json`.

## Implementation roadmap

Steps 1–7 are complete. Work continues from step 8.

| Step | Title | Status |
|---|---|---|
| 1 | Video Draft/Publish Flow | ✅ Done |
| 2 | Rate Limiting for Anonymous Users | ✅ Done |
| 3 | Stripe Payments | ✅ Done |
| 4 | Signed Segment URLs + yt-dlp Throttling | ✅ Done |
| 5 | 2FA for Editor+ Roles | ✅ Done |
| 6 | PWA + Push Notifications | ✅ Done (push has known issues) |
| 7 | Thumbnail Management | ✅ Done |
| 8 | Brevo Newsletter Sync | Pending |
| 9 | RSS / Podcast Feed | Pending |

### Step 8 — Brevo Newsletter Sync

- `packages/api/src/brevo.js` — sync paying subscribers to a Brevo contact list; remove on cancellation.
- Call sync from Stripe webhook on `checkout.session.completed` and renewal; call remove on `customer.subscription.deleted`.
- Admin Newsletter tab: compose subject + body, preview as HTML, send via Brevo campaign API. Requires `admin` or `super_admin` role (NOT editor).
- Store `brevo_subscriber_list_id` in `admin_settings`.

### Step 9 — RSS / Podcast Feed

- Per-user stable RSS token: `HMAC-SHA256(RSS_SECRET, 'rss:' + userId)`.
- `GET /api/feed/:userId/:token` — validates token + active subscription, returns RSS 2.0 with iTunes podcast tags for all published videos.
- Account page section with copyable RSS URL and instructions.
- Public listing feed: `GET /api/feed/public` — stable URL for directory submission; always serves **preview-only** enclosures.
- Account helper: `GET /api/account/rss` (auth required) — returns `{ publicUrl, personalUrl }` for copy/paste into podcast apps.

## Cursor Cloud-specific instructions

### Running services locally

**API** (`packages/api`):

```bash
npm run dev --workspace=@vmp/api   # runs wrangler dev on port 8787
```

- Wrangler emulates D1, R2, KV, and Durable Objects locally — no external services needed.
- Local secrets must be in `packages/api/.dev.vars` (not committed). Required:
  - `JWT_SECRET` — any string >= 32 chars
  - `TOTP_ENCRYPTION_KEY` — any string >= 32 chars
- Without `BREVO_API_KEY`, magic-link URLs are logged to the wrangler console prefixed `[DEV]`.

**Web frontend** (`packages/web`):

```bash
API_URL=http://localhost:8787 npm run dev --workspace=@vmp/web   # Nuxt dev on port 3000
```

- Set `API_URL` to point to the local API; otherwise it defaults to the production URL.

### Database setup

Before the API can serve data, apply all D1 migrations in order:

```bash
cd packages/api
for f in $(ls -1 migrations/*.sql | sort); do
  npx wrangler d1 execute video-subscription-db --local --file="$f"
done
```

Seed videos default to `publish_status = 'draft'`. To make them visible on the public homepage:

```bash
npx wrangler d1 execute video-subscription-db --local \
  --command="UPDATE videos SET publish_status = 'published', published_at = CURRENT_TIMESTAMP WHERE publish_status = 'draft';"
```

### Lint / TypeScript

- No ESLint config exists in the repo.
- TypeScript check for shared: `cd packages/shared && npx tsc --noEmit`
- Nuxt typecheck (`npx nuxi typecheck`) requires a `tsconfig.json` in `packages/web` — the repo does not ship one; run `npx nuxi prepare` first to generate `.nuxt/tsconfig.json`.

### Build

```bash
npm run build --workspace=@vmp/web   # Nuxt production build (Cloudflare Workers / cloudflare-module preset)
npm run preview:workers --workspace=@vmp/web   # local Worker preview (after build)
```

### Gotchas

- The wrangler dev console truncates long log lines. Use a wide terminal (or tmux `resize-window -x 500`) to capture full magic-link tokens.
- Video playback on `/watch/:id` requires actual HLS segments in R2. The seed data has no media files, so the player shows "Media failed to load" — this is expected in a fresh local environment.
- The lockfile is committed (not in `.gitignore`). Do not manually rewrite `package-lock.json`; run `npm install` after any `package.json` version change so `npm ci` succeeds in CI.

### Required Wrangler secrets (for production — set via `wrangler secret put`)

```text
JWT_SECRET              — 32+ random chars
SENTRY_DSN              — Sentry DSN for the API Worker (`@sentry/cloudflare`)
DD_API_KEY              — Datadog API key for optional direct Worker log shipping (`DD_LOGS_ENABLED=true`)
BREVO_API_KEY           — from brevo.com
STRIPE_SECRET_KEY       — from stripe.com dashboard
STRIPE_WEBHOOK_SECRET   — from stripe webhook registration
TOTP_ENCRYPTION_KEY     — AES-256-GCM encryption key for TOTP secrets
VAPID_PRIVATE_KEY       — generated with web-push generate-vapid-keys
RSS_SECRET              — 32+ random chars used only to sign/tokenize personal account RSS URLs (`/api/feed/:userId/:token` and `/api/account/rss`); not required for the public feed endpoint (`/api/feed/public`)
VMP_API_PIPELINE_SECRET — shared with media-pipeline for `POST /api/admin/videos/:id/pipeline-status` HLS availability callbacks
REPLICATION_TARGET_URL — full URL to Deno ingest (`/api/internal/replication/ingest` on api-node)
REPLICATION_TARGET_TOKEN — bearer token for replication ingest (same value as api-node `REPLICATION_INGEST_TOKEN`)
```

Queue bindings (Worker `env` keys, from `packages/api/wrangler.json`): `vmp_replication_events`, `vmp_push_delivery`. Queue resource names: `vmp-replication-events`, `vmp-push-delivery`.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->