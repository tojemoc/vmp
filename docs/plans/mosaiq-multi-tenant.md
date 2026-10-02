# Mosaiq multi-tenant & domain platform

Roadmap IDs: `mosaiq-multi-tenant`, `mosaiq-domain-cutover`, `mosaiq-platform-sites`, `mosaiq-self-serve-channels` (deferred), `worker-split-video-proxy`, `video-proxy-direct-edge` (deferred)

## Goal

Make **this** monorepo (`tojemoc/vmp`, later possibly `moltenmarshmallows/mosaiq*`) able to:

1. Run a **pooled** Worker set on the Mosaiq Cloudflare account.
2. Resolve **tenant by `Host`** → `tenant_id` + config (theme, flags, plan).
3. Attach **many custom domains** (Cloudflare for SaaS) without a Terraform apply per signup.
4. Keep **Start-tier channels** on `*.mosaiq.video` as data (D1 + KV), not infra PRs.

**`vmp-infra` Terraform** owns Cloudflare **platform resources** for Mosaiq: DNS/dual-NS, Worker scripts (shells) + custom domains/routes, D1, KV, Queues, R2 bucket declarations, service bindings, CF for SaaS, Looking Glass. Application **code** and **secrets** still ship from this repo’s CD (`wrangler deploy` / `wrangler secret`). That split is **not** on the hot path for every Start-tier signup—channel rows are D1+KV only.

## Non-goals (this phase)

- Revenue-share self-registration UX and billing of the platform fee.
- Instant trial provisioning product.
- Splitting identity/admin out of the API Worker.
- Option B direct media edge (clients → video-proxy without API front door).
- Renaming the GitHub org/repo (TBD after landing page).

## Domain map (product)

| Hostname | Role |
|----------|------|
| `https://mosaiq.video` | Marketing landing (platform story, CTA). Not a tenant catalog. |
| `https://app.mosaiq.video` (name TBD) | First **hosted production** instance of the product (pooled Workers). Until multi-tenant ship, this is the single live tenant. |
| `https://{channel}.mosaiq.video` | Start-tier **channels** (no custom domain) — deferred product; design Host→tenant now. |
| `https://platform.mosaiq.video` | Operator / Looking Glass entry (may redirect to Vercel Looking Glass). Out of playback path. |
| `https://moltenmarshmallows.com` | Corporate site only. |
| `https://moltenmarshmallo.ws` / `www` | **Redirect** to `moltenmarshmallows.com`. |
| Other `*.moltenmarshmallo.ws` | Infra / CF for SaaS **fallback** and internal service hostnames (API, media, SaaS target). |

**Retire:** `*.tjm.sk` (`vmp.tjm.sk`, `vmp-api.tjm.sk`, etc.). Staging moves onto Mosaiq hosts (e.g. `staging.app.mosaiq.video` or a dedicated staging zone slice)—not a second brand domain.

### Suggested service hostnames (infra handoff)

Concrete names can change; contracts matter:

| Service | Suggested host (CF account `5b594173…`) |
|---------|-------------------------------------------|
| Web (Nuxt Worker) | `app.mosaiq.video` (prod), `staging.app.mosaiq.video` (staging) |
| API Worker | `api.mosaiq.video` **or** same-origin via web→API service binding (preferred long-term) |
| Video proxy (Option A still behind API) | no public host yet; later Option B: `media.moltenmarshmallo.ws` |
| CF for SaaS fallback origin | `sites.moltenmarshmallo.ws` (web) + optional `api-sites.moltenmarshmallo.ws` if API is not same-origin |
| Marketing | `mosaiq.video` / `www.mosaiq.video` |
| Corporate | `moltenmarshmallows.com` |
| Apex redirect | `moltenmarshmallo.ws` → corporate |

Cloudflare account for Mosaiq platform: **`5b594173256386996fe1e03fd5cea3f8`**. Legacy VMP Workers today use a different account id in wrangler (`8298ebe2…`)—cutover must **redeploy** Workers into the Mosaiq account (or explicitly document dual-account forever; prefer one account for Mosaiq prod).

## Architecture principles

- **Per-tenant customization is data**, not a Worker fork: Host → registry → shared code.
- **Bindings are fixed at deploy time**: Start + Pro share pooled Workers + **shared D1 with `tenant_id`**. Only Enterprise (and maybe Mid) get W4P / own bindings.
- **Terraform owns the Cloudflare account shape** for Mosaiq (see [ownership](#vmp-infra--app-ownership)). App CD only uploads Worker **content** and secrets against IDs Terraform outputs.
- **Control plane** (Looking Glass) stays off the playback path. GitOps for infra; runtime registry for tenants.
- **Video-proxy Option A** (API fronts `/api/video-proxy` via service binding) is the next Worker split; **Option B** (direct media host) is roadmap after multi-tenant Host routing is real.

## vmp-infra ↔ app ownership

| Concern | Owner | Notes |
|---------|--------|------|
| Zones, dual NS, product DNS, `.ws` redirects | **Terraform** | Applied (Phase 1a) |
| CF for SaaS fallback + CNAME target + custom hostnames registry | **Terraform** | Applied; no TF per Start signup |
| Worker **names** + custom domains / routes | **Terraform** | Placeholder scripts; `lifecycle ignore_changes` on `content` |
| D1, KV (`TENANT_REGISTRY_KV`, `RATE_LIMIT_KV`), Queues, R2 | **Terraform** | Phase 1b **applied** (ids in `app_handoff`) |
| Service bindings (`API→BILLING`, later `VIDEO_PROXY`) | **Terraform** + app wrangler | TF sets binding; **`entrypoint = BillingService` only in app wrangler** (provider gap) |
| Plain-text Worker `vars` | **Terraform** and/or CD `--var` | Prefer TF → GHA |
| Worker **script content** | **App CD** | Safe with ignore_changes |
| Secrets | **App CD** / `wrangler secret` | Never in git |
| D1 migrations; queue consumers; DO migration tags | **App CD** | First deploy registers consumers/DOs |
| Per-channel Start signup | **App / Looking Glass** | D1 + KV only |

Phases **1a + 1b applied**. **1c** needs `terraform output -json app_handoff` pasted into wrangler + GHA.

## Tenant model

### Registry (source of truth → cache)

Logical tenant record (JSON shape; `vmp-infra/tenants/<id>.json` for GitOps-managed tenants, D1/API for self-serve later):

```json
{
  "id": "demo",
  "tier": "pro",
  "plan": "pro_platform",
  "hosts": ["app.mosaiq.video", "www.customer.example"],
  "primary_host": "app.mosaiq.video",
  "feature_flags": {},
  "theme": { "brandName": "Demo", "logoUrl": null },
  "status": "active"
}
```

**Hot path** (API / future video-proxy): `TENANT_REGISTRY_KV` keyed by normalized hostname → `{ tenant_id, … }`.  
**Cold path / admin:** D1 `tenants` table (same fields). API (or a periodic job) refreshes KV on write. Looking Glass / onboard scripts may still open PRs for **vanity DNS** when GitOps DNS slices are enabled; channel subdomains under a pre-delegated `*.mosaiq.video` must **not** require Terraform.

### D1

- Add `tenants` table.
- Add `tenant_id TEXT NOT NULL` (FK) to tenant-scoped tables: `videos`, `users` (or a membership join), `subscriptions`, `admin_settings` (composite PK `(tenant_id, key)`), categories, CMS, etc.
- Backfill existing single-tenant rows to `tenant_id = 'default'` (or `legacy`) in one migration.
- Unique constraints become **per-tenant** (`UNIQUE(tenant_id, email)`, `UNIQUE(tenant_id, slug)`, …).
- Schemas stay identical for later pooled → siloed (W4P) promotion: copy rows + flip routing.

### Request resolution

1. Read `Host` (and CF for SaaS hostname).
2. KV lookup → `tenant_id` (miss → 404 / unknown host page).
3. Attach `tenant_id` to request context; **every** D1 query filters by it.
4. Never trust client-supplied `tenant_id`.

### CORS / magic links / URLs (replace single `FRONTEND_URL`)

Today: one `FRONTEND_URL` + CSV `ALLOWED_ORIGINS` (see `buildCorsHeaders`, auth magic links, push, feeds).

Target:

- **CORS:** allow `Origin` if hostname maps to an active tenant (or is in a small platform allowlist for Looking Glass).
- **Magic link / emails:** use tenant `primary_host` (https).
- **RSS / OG / absolute links:** tenant primary host, not a global env default.
- Keep `FRONTEND_URL` only as **local-dev fallback** and staging smoke default.

### Web (Nuxt) multi-host

Build-time `API_URL` / `NUXT_PUBLIC_SITE_URL` cannot describe N custom domains.

Prefer:

1. **Same-origin API** on the web hostname (`/api/*` → API via service binding or route), **or**
2. Runtime resolve `apiBase` / `siteUrl` from `Host` + registry.

Until same-origin exists, document a single prod host for the first deploy and implement Host-aware config before enabling the second custom domain.

## Tier ↔ hosting

| Tier | Domains | Workers | DB |
|------|---------|---------|-----|
| Start (revenue share) | `{channel}.mosaiq.video` only | Pooled | Shared D1 + `tenant_id` |
| Pro (€99) | Custom domain via CF for SaaS | Pooled | Shared D1 + `tenant_id` |
| Mid (€499) | Custom domain | Pooled **or** W4P (undecided—keep Terraform modular) | Same schema |
| Enterprise | Custom domain | W4P dispatch, own Worker copy | Own D1, same schema |

## Phased delivery

### Phase 0 — Design (this document)

Roadmap + contracts + infra handoff. No runtime multi-tenant yet.

### Phase 1 — Domain + data-plane cutover (`mosaiq-domain-cutover`)

**1a — Applied (vmp-infra):** product hostnames, pooled Worker shells (`vmp-api`, `vmp-api-staging`, `vmp-web-worker-prod`, `vmp-web-worker-dev`), `TENANT_REGISTRY_KV`, CF for SaaS (`sites` / `customers`), `.ws` redirects, Looking Glass CNAME, marketing/corporate placeholders.

**1b — Applied (vmp-infra):** `vmp-billing` / `vmp-billing-prod` + `BILLING` binding; shared D1 `video-subscription-db`; `RATE_LIMIT_KV`; queues; R2 `vmp-videos` (default); plain vars; Worker content `ignore_changes`. App must still set `entrypoint = "BillingService"` in wrangler. Canonical copy lives in vmp-infra `docs/MOSAIQ_APP_HANDOFF.md`; run `terraform output -json app_handoff` for ids.

**1c — App repo (next):**

1. Paste `app_handoff` JSON (needs `d1.database_id`, both KV ids).
2. Flip wrangler `account_id` → `5b594173…`; staging API Worker name → `vmp-api-staging`; bind D1/KV/R2/queues/`TENANT_REGISTRY_KV`; keep `BILLING` + entrypoint.
3. Set GHA vars (`FRONTEND_URL_*`, `API_URL_*`, `ALLOWED_ORIGINS`, `CLOUDFLARE_ACCOUNT_ID`) per handoff §9.
4. Put secrets; run migrations; `wrangler deploy` api + billing + web; smoke staging then prod; leave `*.tjm.sk`.

Still one logical tenant until Phase 2; optional shim `tenant_id = 'default'`.

### Phase 2 — Tenant substrate (`mosaiq-multi-tenant`)

- Migrations: `tenants` + `tenant_id` columns + backfill.
- `resolveTenant(request)` + KV registry binding.
- CORS / magic-link / feed origin from tenant.
- Admin + public queries scoped by `tenant_id`.
- Seed second host (e.g. staging or a demo channel) proving isolation.

### Phase 3 — Custom domains (`mosaiq-custom-hostnames`)

- CF for SaaS: customer CNAME → `sites.moltenmarshmallo.ws`.
- Onboard = insert host on tenant + KV put (+ optional SSL validation status). **No Terraform per domain** once SaaS is configured.
- Pro marketing can promise custom domains after this phase.

### Phase 4 — Platform sites (`mosaiq-platform-sites`)

- Real marketing site on `mosaiq.video`.
- Corporate site on `moltenmarshmallows.com`.
- `platform.mosaiq.video` → Looking Glass.

### Phase 5 — Self-serve channels (deferred) (`mosaiq-self-serve-channels`)

- Instant: tenant row + `{slug}.mosaiq.video` + KV; trial clock.
- No TF in signup path; wildcard DNS already on platform zone.
- Platform fee / revenue-share billing later.

### Parallel: Worker split

- `worker-split-video-proxy` — Option A (API service binding). Stateless proxy; tenant from KV only when needed; no D1 on hot path.
- `video-proxy-direct-edge` — Option B later for control-plane-down playback.

## App touch points (inventory)

| Area | Today | Change |
|------|--------|--------|
| `packages/api/wrangler.json` | Single account, `FRONTEND_URL`, `ALLOWED_ORIGINS` | Mosaiq account; `TENANT_REGISTRY_KV`; tenant-aware CORS |
| `packages/api/src/auth.ts` | Magic links → `FRONTEND_URL` | Tenant primary host |
| `packages/api/src/index.ts` `buildCorsHeaders` | CSV allowlist | Host/tenant allow |
| `packages/api/src/feed.ts`, push, deletion | `FRONTEND_URL` | Tenant host |
| `packages/billing` | Checkout return `FRONTEND_URL` | Pass tenant return URL from API |
| `packages/web/nuxt.config.ts` | Build-time `vmp.tjm.sk` defaults | Mosaiq defaults; runtime Host |
| Deploy Action | `FRONTEND_URL_STAGING/PROD` | Mosaiq URLs; eventually multi-origin smoke |
| D1 migrations | No `tenant_id` | Additive migrations only |

## Testing strategy (when implementing)

- Unit: Host → tenant resolution, CORS allow/deny, uniqueness per tenant.
- Integration: two tenants in local D1+KV; video list isolation; magic-link host.
- Smoke: health + CORS on `app.mosaiq.video` after domain cutover.
- No UI marketing polish required for Phase 1–2.

## vmp-infra boundary

**Does:** full Mosaiq Cloudflare **account resource graph** (DNS, Workers shells/domains, D1, KV, Queues, R2, service bindings, CF for SaaS, Looking Glass DNS), plus GitOps `tenants/*.json` for **ops-managed** tenants.

**Does not:** per Start-tier signup PRs; application business logic; HLS request path; (usually) Worker bundle contents after bootstrap.

Handoffs:

- Phase 1a (domains / shells) — [vmp-infra-handoff-mosaiq-domains.md](./vmp-infra-handoff-mosaiq-domains.md) (**applied**)
- Phase 1b (data plane / billing / bindings) — [vmp-infra-handoff-mosaiq-data-plane.md](./vmp-infra-handoff-mosaiq-data-plane.md) (**applied**; ids via `app_handoff`)
- Phase 1c — app cutover in this repo (blocked on pasting `terraform output -json app_handoff`)
