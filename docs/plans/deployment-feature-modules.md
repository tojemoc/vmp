# Deployment feature modules

Roadmap ID: `deployment-feature-modules`

## Problem

VMP is moving toward multiple deployment shapes from one codebase:

- **Full instance** — `vmp.tjm.sk` staging/production with the complete product surface.
- **Shared hosted** — Mosaiq-style subdomain / channel slugs on shared Workers.
- **Shared SaaS (BYOD)** — one codebase, customer domains, tenant-scoped D1.
- **Dedicated slim Workers** — optional packages omitted entirely from the build.

Today, optional surfaces (GTM, PostHog, CMS, pills, …) are always compiled in. Runtime toggles exist for some tenant settings (`/api/admin/system/features`, `gtm_enabled`), but there is no **deploy-time allowlist** to exclude code from a Worker build or to hide admin controls when a module is not shipped.

GTM is the canonical example: it loads from `features/gtm/plugin.client.ts` when admin enables it in D1, but the plugin was always bundled until this work.

## Three control planes

| Plane | Mechanism | Example |
|-------|-----------|---------|
| **1. Infra (Tier 1)** | Cloudflare Flagship booleans (`FLAGS` binding; code default off) | Staging turns off `gtm` → API 404 + admin grayed |
| **2. Tenant runtime** | D1 `admin_settings`, `/api/admin/system/features` | `gtm_enabled`, `promotions_enabled`, `rss_free_preview_enabled` |
| **3. Rollout / UX experiments** | PostHog SSR/client flags (Tier 2) | A/B a checkout layout while `payments` stays Flagship-on |

Flagship gates **availability**. Tenant runtime gates **configuration**. Rollout flags gate **behaviour** within an enabled module.

> **Migration:** Compile-time `VMP_FEATURES` was removed. See [flagship-and-payment-middleware.md](./flagship-and-payment-middleware.md).

Do not use GTM for PostHog or core product analytics — see [analytics-observability.md](./analytics-observability.md).

## Flagship allowlist (replaces `VMP_FEATURES`)

Per-feature boolean flags in the Flagship app (staging: `e1bb7ed4-8309-458f-9f60-cb61f881685a`). Local override: `FLAGSHIP_DEV_OVERRIDE` CSV in `.dev.vars` only.

Catalog: `packages/shared/src/deploymentFeatures.ts`. Web hydrates `GET /api/deployment-features` into `useDeploymentFeatures` with per-id state:

```ts
{ requested, pluginPresent, compiled }
```

- `requested` — Flagship (or local override) enabled.
- `pluginPresent` — modular plugin files exist on disk.
- `compiled` — `requested && pluginPresent`; safe to load routes/plugins.

## Modular vs integrated features

| Style | Location | Omit from slim build |
|-------|----------|----------------------|
| **Modular** | `packages/web/features/<id>/` | Delete or exclude folder; admin shows “plugin files missing” |
| **Integrated** | `nuxt.config`, core pages, API routes | Gate with Flagship + route/admin checks (code may still bundle until split) |

**Phase 1 + Flagship migration:**

- Catalog in `@vmp/shared`; runtime via Flagship (`infraFlags`)
- Web `useDeploymentFeatures()` hydrates from `GET /api/deployment-features`
- **GTM** / **PWA** / **PostHog** plugins always registered when present (A1); Flagship + token/D1 gate behaviour

## Feature catalog (target)

| ID | Admin / product surface | Tenant toggle (existing / planned) | Notes |
|----|-------------------------|-----------------------------------|-------|
| `gtm` | System → GTM fields | `gtm_enabled` | Modular plugin |
| `posthog` | Consent banner, `$posthog` | consent localStorage | Also needs `NUXT_PUBLIC_POSTHOG_*` |
| `analytics` | Admin **Analytics** tab | — | First-party D1 segment analytics |
| `cms` | Admin **Pages** tab, `/[slug]` | — | |
| `pwa` | `@vite-pwa/nuxt`, install prompt | — | Phase 2: conditional module |
| `push` | Admin **Notifications**, video notify | — | |
| `pills` | Admin **Pills** tab | — | |
| `newsletter` | Admin **Newsletter** tab | Brevo settings | |
| `einvoicing` | Admin **E-invoicing** tab | — | |
| `legacy_migration` | Admin **Legacy migration** tab | — | Hide entire tab when off |
| `rss_podcast` | RSS endpoints, podcast settings | `rss_*` settings | Rename from “free podcast preview feed” |
| `rss_podcast_preview_mp3` | Preview MP3 prerender pipeline | child of `rss_podcast` | Sub-toggle; fix preview-length save copy when parent off |
| `payments` | Payment gateways accordion | `payments_enabled_providers` | Per-gateway sub-toggles: Stripe, GoPay, Comgate, Qerko; default plan price when gateway price empty; CZK where supported |
| `deno_replication` | System → Deno Postgres failover | replication mode settings | “Deno push” in product language |

### Payment gateways (phase 3)

Extend `payments` module:

- One parent toggle `payments` (compile-time + tenant).
- Sub-toggles per provider in Admin → System → Payment gateways.
- Hide provider fields when provider unchecked.
- Empty gateway-specific price → fall back to plan price from `admin_settings`.
- Allow CZK amounts where the provider supports major-unit admin_settings (GoPay/Comgate already documented in `packages/payments/README.md`).

### RSS podcast parent / child (phase 3)

Replace `freePodcastPreviewEnabled` naming with:

- Parent: `rss_podcast` (tenant + compile-time).
- Child: `rss_podcast_preview_mp3` — only shown when parent compiled **and** tenant-enabled.
- When child off: preview-length save shows neutral copy (“preview MP3 prerender disabled”) instead of failure-style errors.

## API Worker

Mirror `VMP_FEATURES` as a Worker var (same string). Phase 2:

- `packages/api/src/deploymentFeatures.ts` — parse env, export `isFeatureCompiled(id)`.
- Gate route registration and admin handlers (e.g. skip `/api/pills/*` when `pills` off).
- Expose `GET /api/admin/deployment-features` (read-only manifest for admin UI gray states).

## Rollout flags (PostHog / Cloudflare)

Compile-time modules answer: *can this deployment ever use feature X?*

PostHog / Cloudflare flags answer: *should we show variant Y to this user right now?*

Guidelines:

- Flag **UX-visible** changes (checkout step order, hero layout, player chrome).
- Do **not** flag safety, auth, or billing invariants.
- Prefer PostHog flags when the experiment needs analytics attribution; Cloudflare Flags when edge-only and no PostHog dependency.
- Every flag should name its **compile-time parent** in the experiment doc (e.g. `payments` must be compiled).

## Deployment profiles (illustrative)

| Profile | Typical Flagship enable set |
|---------|------------------------------|
| `vmp-full` | all catalog booleans `on` |
| `vmp-staging-no-gtm` | all except `gtm` |
| `mosaiq-channel` | `posthog,payments,cms,analytics,pwa,push` |
| `player-only` | `posthog,payments,pwa` |

Configure in the Cloudflare Flagship app per environment (not GitHub `VMP_FEATURES`).

## Implementation phases

### Phase 1 — Foundation + GTM

- [x] `@vmp/shared` catalog + allowlist CSV parser
- [x] Web modular plugins under `features/*`
- [x] GTM modular plugin
- [x] Admin GTM fields respect infra flags
- [x] PostHog module when project token present; Flagship gates product use
- [x] Superseded: `VMP_FEATURES` → Flagship (see flagship plan)

### Phase 2 — Admin surfaces + API parity

- [x] `useDeploymentFeatures()` drives admin tab visibility (`legacy_migration`, `pills`, `newsletter`, …)
- [x] API Flagship route guards
- [x] `GET /api/admin/deployment-features` + public `GET /api/deployment-features`
- [x] PWA module always-register (A1)

### Phase 3 — Tenant toggles alignment

- [x] Payment gateway sub-toggles + price fallback rules (GoPay/Comgate → plan price)
- [x] RSS parent/child rename + preview MP3 messaging
- [x] Extend `/api/admin/system/features` PATCH schema

### Phase 4 — Slim packages / dedicated Workers

- [x] `packages/features/README.md` — optional workspace layout + slim build workflow
- [x] Modular `packages/web/features/*` plugins (gtm, pwa, posthog)
- [x] Document Mosaiq + BYOD tenant binding (in plan + packages/features README)

## Related docs

- [analytics-observability.md](./analytics-observability.md) — canonical analytics stack (PostHog in-app, GTM optional)
- [packages/payments/README.md](../../packages/payments/README.md) — provider registry
