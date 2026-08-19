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

VMP (Video Monetization Platform) is a subscription-gated HLS video streaming platform. npm workspaces monorepo — see [README.md](README.md) for the full package table. Core packages:

| Package | Path | Runtime |
|---|---|---|
| `@vmp/api` | `packages/api` | Cloudflare Worker (TypeScript) — REST API, auth, Stripe, push, thumbnails |
| `@vmp/web` | `packages/web` | Nuxt 4 / Vue 3 frontend (TypeScript) — Cloudflare **Worker** SSR (`packages/web/wrangler.workers.toml`) |
| `@vmp/shared` | `packages/shared` | Shared TypeScript types |
| `@vmp/storage` | `packages/storage` | Pluggable object storage (R2 / S3-compatible) |
| `@vmp/payments` | `packages/payments` | Payment provider registry (Stripe, legacy Qerko) |
| `@vmp/api-node` | `packages/api-node` | Deno Deploy backup API (Postgres + S3 adapters) |
| `@vmp/media-pipeline` | `packages/media-pipeline` | Media VM: SVT Encore + Shaka HLS → R2 |

### Infrastructure

| Concern | Service |
|---|---|
| Video/asset storage | Cloudflare R2 |
| API + auth backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Config format | `wrangler.json` for `@vmp/api` (exception: `@vmp/web` uses `wrangler.workers.toml`) |
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

Fully implemented in `packages/api/src/auth.ts`. Key exports:
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
| — | Native / TV clients (multi-tier) | Phase 0 + Tier 1 scaffold — see [docs/native-clients-plan.md](docs/native-clients-plan.md) |
| 10 | Self-Service Account Deletion | Pending (blocked on payment gateway adapter) |

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

### Playback position resume (#488)

- D1 table `playback_positions` stores last VOD position per signed-in user/video.
- API: `GET/PUT/DELETE /api/account/playback-positions/:videoId`, list at `GET /api/account/playback-positions`.
- Resume requires sign-in **and** active subscription with full access (not preview-only).
- Near-end clear uses **duration-tiered** thresholds from `@vmp/shared` (`playbackPosition.ts`): short-form (≤5 min) uses a proportional 15% tail; long-form keeps 30s absolute + 95% fraction.
- Periodic save interval scales with duration (~10% of clip length, clamped 5–30s).
- Positions for all users on a video are cleared when the pipeline reports `fully_processed` (re-encode under same ID). Admins can also call `DELETE /api/admin/videos/:id/playback-positions` (requires `admin` or `super_admin`; editors cannot).
- Account page **Continue watching** lists in-progress VOD; users can remove individual saved positions.
- Client `capturedAtMs` writes are clamped if >5 min ahead of server time; stale rejection is skipped when stored timestamp is skewed into the future (clock recovery).
- Catalog short-form share is still unknown — if most content is under 5 minutes, revisit thresholds in `@vmp/shared`.

#### Known limitations and future improvements

- **Re-encode clears all positions:** The `fully_processed` pipeline callback clears every user's saved position, including quality-only re-encodes where the timeline is unchanged. To preserve resume on quality upgrades, the pipeline callback would need a `contentChanged` flag — this requires a media-pipeline contract change. The admin endpoint `DELETE /api/admin/videos/:id/playback-positions` is available as a manual alternative.
- **Postgres (api-node) migration compatibility:** Migration files use D1/SQLite SQL. The `translateSqliteDdl` function in `packages/api-node/src/bindings/sqlDialect.ts` handles most translations. SQLite-only functions (`json_insert`, `json_valid`, `json_type`, `json()`) are not translatable — statements using them are stripped. `instr()` is translated to `strpos()`. When writing new migrations that use SQLite-specific JSON functions, add a comment explaining the Postgres fallback and ensure the REPLACE-based paths cover the common case.
- **Client clock skew:** A device whose clock is ahead by up to 5 minutes can suppress writes from other devices for that duration. This is acceptable for a resume feature; server-side timestamp arbitration would require a more complex API contract.

### Step 10 — Self-Service Account Deletion

**Blocked on**: payment gateway adapter completion (all Stripe-touching work is on hold until the adapter is provider-agnostic).

#### API (`@vmp/api`)

- `POST /api/account/delete-request` — auth-required; sends a one-time verification email (via Brevo) with a signed HMAC token (short TTL ~15 min).
- `POST /api/account/delete-confirm` — validates token + requires user to submit a confirmation phrase (e.g. "I understand my subscription will be cancelled without refund").
- On confirmation:
  - Cancel active subscription immediately via the payment gateway adapter (no refund).
  - `DELETE FROM users WHERE id = ?` — `ON DELETE CASCADE` foreign keys on `playback_positions`, `refresh_tokens`, `magic_link_tokens`, `push_subscriptions` handle cleanup.
  - Revoke all sessions (delete refresh tokens, invalidate JWT).
  - Optionally: Brevo contact removal.
- New migration: `deletion_confirmations` table or reuse `magic_link_tokens` with a type discriminator.

#### Web (`@vmp/web`)

- Account page section: "Delete my account" with warning copy.
- Confirmation flow: email sent → enter code/click link → type confirmation phrase → done.
- Redirect to homepage post-deletion.

#### Legal / regulatory (CZ + SK)

- **Czech law**: Consumer Protection Act (zákon č. 634/1992 Sb.), Civil Code (zákon č. 89/2012 Sb.) — digital content contracts; EU Consumer Rights Directive implemented via § 1820+ of the Civil Code. For digital content/services delivered immediately (streaming access), the 14-day withdrawal right can be waived with prior express consent.
- **Slovak law**: zákon č. 102/2014 Z.z. — same EU directive transposition, same waiver mechanism.
- **Key wording**: pre-purchase consent checkbox or acknowledgment that (a) access begins immediately upon payment, (b) the consumer waives the 14-day withdrawal right, and (c) all sales are final with no refund for the remaining subscription period upon cancellation or deletion.
- **GDPR Art. 17 (right to erasure)**: the self-service flow satisfies this; the support-channel fallback remains as backup.

#### Checkout integration

The "all sales are final" / waiver-of-withdrawal consent should be captured **at checkout time**, not at deletion time. This means adding consent text to the checkout flow via the payment gateway adapter (e.g. Stripe `custom_text` on Checkout Session, or a pre-checkout step in the frontend).

## Cursor Cloud-specific instructions

### MoQ livestreams

When touching **anything related to MoQ livestreams** (MoQ packages, livestream APIs/migrations, `@moq/*` dependencies, player/relay wiring, or related composables), follow the official MoQ agent prompt before making changes:

**https://doc.moq.dev/setup/agent/prompt.md**

That prompt installs the MoQ skill and covers architecture, packages, relay setup, and pitfalls. Also see `.cursor/rules/moq-livestreams.mdc` and the `agent.notes` entry in `.cursor/environment.json`.

### iOS SideStore test distribution (`apps/mobile`)

Manual workflow: `.github/workflows/mobile-artifacts.yml` (`workflow_dispatch` only — not on every push).

- **SideStore / AltStore source URL:** `https://tojemoc.github.io/vmp/altstore-source.json`
- **Install page:** `https://tojemoc.github.io/vmp/`
- **Playbook:** [docs/ios-sidestore-distribution-playbook.md](docs/ios-sidestore-distribution-playbook.md)

IPAs are published as **GitHub Release assets** (`vmp-<version>-ios.ipa`). The AltStore source JSON is generated from `docs/altstore-source.meta.json` and deployed to GitHub Pages via the official Pages deploy actions (never committed to `main`). Testers add the source URL in SideStore on iPhone — **no Mac required**. Publishing (GitHub Releases + Pages) is allowed from `main` only; feature branches may run artifact-only builds with `publish_release` disabled.

Packaging: `scripts/package-ios-ipa-for-sidestore.sh` (ad-hoc sign + `Payload/App.app` zip layout). Source generator: `scripts/generate-altstore-source.py` (dedupes by `(version, buildVersion)`; prefers release > beta > nightly > development tags).

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

- Lint/format: Biome (`biome.json`). `npm run lint` → `biome check .`; `npm run format` → `biome format --write .`.
- TypeScript is dual-installed: `npx tsc` is TypeScript **7** (`@typescript/native`), while `require('typescript')` resolves to TypeScript **6** (`@typescript/typescript6`) for `vue-tsc` / tooling that still need the JS compiler API.
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

Optional API Worker **vars** (runtime, Cloudflare dashboard / `wrangler.json` / `.dev.vars` — not GitHub Actions):

```text
POSTHOG_PROJECT_TOKEN — public PostHog project token (same value as NUXT_PUBLIC_POSTHOG_KEY on the frontend)
POSTHOG_HOST          — ingest host; defaults to https://eu.i.posthog.com (also in wrangler.json vars)
```

Frontend PostHog token is **baked at Nuxt build time** (GitHub repo vars → deploy action). Use any of `NUXT_PUBLIC_POSTHOG_KEY`, `NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, or `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` (maps to `runtimeConfig.public.posthog.publicKey`). CI coalesces all three from the repo vars.

Do **not** put `POSTHOG_PERSONAL_API_KEY` on the API Worker. That key is GitHub-only for web source-map upload.

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