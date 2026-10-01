# Flagship infrastructure flags + payment middleware

Roadmap IDs: `infra-flagship-flags`, `payment-middleware`

## Goal

1. Replace the `VMP_FEATURES` env-var allowlist with **Cloudflare Flagship** boolean flags (Tier 1 infrastructure toggles).
2. Ensure **PostHog** server-side SDK setup on Nuxt SSR is ready for future product/experiment flags (Tier 2) — **do not create PostHog flags yet**.
3. Introduce a **product payment middleware** above the existing `@vmp/payments` provider adapters so the rest of the product never imports PSP clients directly.

This plan is the contract for a multi-PR rollout. Do not ship everything in one PR.

## Current state (as of plan authoring)

### `VMP_FEATURES` (compile-time + API runtime)

| Concern | Today |
|---------|--------|
| Catalog | `packages/shared/src/deploymentFeatures.ts` — 14 IDs including `gtm` |
| Default when unset | **All features ON** (`DEFAULT_DEPLOYMENT_FEATURES`) |
| Web | Parsed at Nuxt build → baked into `runtimeConfig.public.deploymentFeatures`; modular plugins (`gtm`, `pwa`, `posthog`) registered only when compiled |
| API | Worker var via deploy `--var VMP_FEATURES:…`; `routeFeatureGuard` returns 404 `FEATURE_NOT_COMPILED` |
| Deploy | GitHub Environment `vars.VMP_FEATURES` → `.github/actions/deploy-cloudflare` |

Shipped plan: [deployment-feature-modules.md](./deployment-feature-modules.md) (phases 1–4). That doc’s “three control planes” already anticipated Cloudflare Flags / PostHog for plane 3; this work **moves plane 1 from env allowlist to Flagship**.

### Cloudflare Flagship (target Tier 1)

Native Workers binding ([docs](https://developers.cloudflare.com/flagship/)):

```jsonc
{
  "flagship": [
    {
      "binding": "FLAGS",
      "app_id": "<APP_ID>"
    }
  ]
}
```

Evaluation (safe default OFF in code):

```ts
const payments = await env.FLAGS.getBooleanValue('payments', false);
```

Local `wrangler dev` evaluates against the **live** Flagship app (no local flag store).

### PostHog (Tier 2 readiness)

| Surface | Status |
|---------|--------|
| API Worker | `posthog-node` via `packages/api/src/posthog.ts` — capture, exceptions, identity HMAC, metrics/logs. **No feature-flag evaluation.** |
| Web client | `@posthog/nuxt` + `features/posthog/*` (consent/identity). Gated by `posthog` ∈ `VMP_FEATURES` + token. |
| Web SSR | Custom Nitro plugin captures **5xx only**; module autocapture intentionally off. **No `getFeatureFlag` / bootstrap.** |
| Gap | No shared server-side PostHog client on Nuxt SSR for flag evaluation without a browser round-trip. |

### Payments

| Layer | Status |
|-------|--------|
| `@vmp/payments` | `PaymentProvider` adapter + registry for `stripe` / `qerko` / `gopay` / `comgate` |
| GoPay / Comgate | **Full HTTP implementations** exist (not stubs); operational only with secrets + admin enable |
| Qerko | Live via legacy eshop callbacks; D1 stores `provider = 'legacy'` |
| Product facade | **Missing** — no `hasSubscription` / `createSubscription` / `cancelSubscription` / `getSubscription` middleware |
| Schema | `subscriptions.provider` (`stripe` \| `legacy` \| `gopay` \| `comgate`); **no** `billing_source` |
| Web | `@stripe/stripe-js` for embedded Checkout Elements |
| PostHog lifecycle | Stripe (+ some legacy) webhooks only; GoPay/Comgate webhooks skip Stripe-only PostHog mapper |

---

## Ambiguities (resolve before / during Phase A–C)

These block or reshape implementation. Preferred defaults are noted where the success criteria imply one.

### A1. Compile-time vs runtime (critical)

`VMP_FEATURES` today can **omit Nuxt modules from the build** (`@posthog/nuxt`, `@vite-pwa/nuxt`, GTM plugin). Flagship is **runtime-only** and unavailable during `nuxt build`.

**Options:**

| Option | Behaviour |
|--------|-----------|
| **A1-a (recommended)** | Flagship becomes the **runtime** gate for API routes + admin UI + entitlement of modules. Keep an optional slim-build allowlist later if dedicated Workers still need tree-shaking; stop reading `VMP_FEATURES`. Always register modular plugins/modules that have secrets/config, but **no-op** when Flagship flag is off (or when binding missing → default false). |
| **A1-b** | Dual system: Flagship for API; keep a build-time env for Nuxt module registration under a new name. Violates “`VMP_FEATURES` is no longer read anywhere” if we keep the same name. |
| **A1-c** | Always bundle everything; Flagship only gates API + SSR-fetched flag bootstrapping for admin UI. Accept larger web Worker. |

**Decision needed:** Confirm A1-a (or choose another). Bundle-size regression for slim Mosaiq profiles is the main risk.

### A2. Default OFF vs staging continuity (critical)

Success criteria: Flagship flags **default OFF**; currently enabled features must be **explicitly enabled in the Flagship dashboard**.

Cutover without a pre-enabled Flagship app turns **staging/production dark** (no payments, PWA, CMS, …).

**Required ops before code cutover:**

1. Create Flagship app(s) for API (+ web if bound).
2. Create boolean flags for every catalog ID; set default variation `off`.
3. Enable the current staging/prod allowlist **before** merging the PR that removes `VMP_FEATURES`.
4. Document `FLAGSHIP_APP_ID` (or hardcode app id in wrangler per env).

**Decision needed:** Who creates the Flagship app and supplies `app_id`? Staging and production — one app or two?

### A3. Web Worker Flagship access

Admin UI and composables currently read **baked** `runtimeConfig.public.deploymentFeatures`. After Flagship:

| Option | Notes |
|--------|-------|
| **A3-a** | Bind Flagship on **web** Worker (`wrangler.workers.toml`) and evaluate in Nitro SSR / server routes; expose `GET /api/...` or Nitro handler that hydrates client. |
| **A3-b** | Bind Flagship only on **API**; web calls existing `GET /api/admin/deployment-features` (or a public bootstrap endpoint) which evaluates Flagship. |
| **A3-c** | OpenFeature HTTP SDK from Nuxt (token risk / latency); not preferred. |

**Recommended:** A3-b for fewer wrangler secrets/apps, reusing the admin manifest endpoint (extend for non-admin bootstrap if public pages need flags). Cloudflare docs warn against Flagship **client** provider with API tokens in the browser.

### A4. `gtm` and catalog parity

User list omits `gtm`; catalog includes it. Treat `gtm` as a Flagship flag with the same name for parity, or drop it from the catalog?

**Recommended:** Keep `gtm` as a Flagship infra flag (same as today).

### A5. Local / CI without Flagship credentials

Flagship local eval hits the live app. Tests today parse env strings synchronously.

**Recommended:** Introduce `FlagEvaluator` interface with:

- `FlagshipEvaluator` (`env.FLAGS.getBooleanValue(key, false)`)
- `StaticEvaluator` / `AllowAllEvaluator` for unit tests
- Optional `FLAGSHIP_DEV_OVERRIDE=payments,posthog,…` **only in `.dev.vars`** for offline agents — **not** production, and not named `VMP_FEATURES`

Confirm whether a local override env is acceptable (success criteria ban reading `VMP_FEATURES`, not all override mechanisms).

### A6. GoPay / Comgate: stub vs keep implementation

User asks for adapters that **throw `NotImplementedError`** and “do not delete the code.” Code today is full HTTP providers.

**Recommended:** Keep implementations behind `isConfigured()`; product middleware refuses to **route new checkouts** to GoPay/Comgate until a future flag/keys exist; adapter methods throw `NotImplementedError` from the **middleware router** when selected for new subs, while leaving provider source in place. Alternatively wrap providers so `createCheckoutSession` / `createSubscription` throw unless `isConfigured()` — already mostly true without keys.

**Decision needed:** Soft-disable (keys + admin enable remain) vs hard stub that always throws even with keys present.

### A7. `billing_source` vs existing `provider`

User interface uses `PspSource = 'stripe' | 'qerko' | 'gopay' | 'comgate' | 'mor'`. DB has `provider` with `legacy` for Qerko.

**Options:**

| Option | Migration? |
|--------|------------|
| **A7-a (recommended)** | Middleware maps `legacy` ↔ `qerko` at the boundary; no schema migration. Document `billing_source` as the **API-facing** name. |
| **A7-b** | Add `billing_source` column + backfill — **flag first** per “do not introduce schema migration without flagging.” |

### A8. Frontend `@stripe/stripe-js`

Success criteria: “No PSP SDK imported outside the middleware/adapters.” Stripe Elements **must** run in the browser.

**Recommended:** Treat “middleware” as server-side product API; allow a thin `packages/web` Stripe Elements adapter that only talks to `/api/payments/*`. Document as exception. Do not move Elements into `@vmp/payments` (DOM / Nuxt free).

### A9. Product middleware method shapes vs checkout reality

Requested:

```ts
hasSubscription(email: string): Promise<{ active: boolean; source: PspSource }>
createSubscription(params): Promise<SubscriptionResult>
cancelSubscription(email: string, source: PspSource): Promise<void>
getSubscription(email: string): Promise<SubscriptionRecord | null>
```

Today checkout is **async** (Stripe client_secret / redirect URL); identity is **userId** from JWT, not email alone; cancel often uses `subscriptionId`.

**Recommended:** Middleware methods are the product API; `createSubscription` may return `{ type: 'checkout', clientSecret | checkoutUrl }` (rename internally if needed). Prefer resolving subscriber by **authenticated userId**, with email as lookup helper for PSP customer search. Keep webhook / portal / refund on adapters, not necessarily on the thin product interface.

### A10. Country → MoR routing stub

Implement `selectPspForNewSubscription({ billingCountry, existingSource })` that:

- if `existingSource === 'qerko'` → Qerko (manage only; create gated by `legacy_migration`)
- else if country in tax-handled set → Stripe (Comgate later)
- else → throw `NotImplementedError('mor')`

**Decision needed:** Which countries are in the “tax handled” set for the stub? (Empty set + always Stripe until configured is safest.)

### A11. PostHog SSR flag evaluation library

`posthog-node` supports `getFeatureFlag` / `getAllFlags`. Nuxt SSR needs a **singleton or per-request** client with `waitUntil` flush — today only exception capture instantiates a client.

**Recommended:** Add `packages/web/server/utils/posthogServer.ts` (or similar) that:

- Lazily constructs `PostHog` from runtimeConfig public key
- Exposes `getFeatureFlag` / `getAllFlags` for future use
- Does **not** register any flags or call sites beyond a smoke test / health helper

API Worker already has a client — optionally add the same flag helpers there for symmetry.

---

## Target architecture

```text
                    ┌─────────────────────┐
                    │ Cloudflare Flagship │
                    │  (infra booleans)   │
                    └──────────┬──────────┘
                               │ env.FLAGS
                               ▼
┌──────────────┐      ┌────────────────────┐      ┌─────────────┐
│  Nuxt web    │─────▶│  @vmp/api Worker   │─────▶│ PostHog     │
│  (SSR/UI)    │ REST │  route guards +    │      │ (events +   │
│              │◀─────│  payment middleware│      │  future FF) │
└──────────────┘      └─────────┬──────────┘      └─────────────┘
                                │
                                ▼
                      ┌─────────────────────┐
                      │ PaymentMiddleware   │  ← product-only API
                      │ (Nuxt-free)         │
                      └─────────┬───────────┘
                                │ billing_source / provider
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
         StripeAdapter    QerkoAdapter      GoPay/Comgate/MoR
         (live)           (legacy_migration) (stub / NotImplemented)
```

### Flag catalog (Tier 1 — Flagship keys = existing IDs)

`posthog`, `pwa`, `push`, `payments`, `cms`, `analytics`, `newsletter`, `einvoicing`, `legacy_migration`, `rss_podcast`, `rss_podcast_preview_mp3`, `pills`, `deno_replication`, and **`gtm`** (see A4).

Code default: `getBooleanValue(id, false)` always.

### Payment middleware interface (draft)

```ts
export type PspSource = 'stripe' | 'qerko' | 'gopay' | 'comgate' | 'mor';

export interface PaymentMiddleware {
  hasSubscription(email: string): Promise<{ active: boolean; source: PspSource }>;
  getSubscription(email: string): Promise<SubscriptionRecord | null>;
  createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult>;
  cancelSubscription(email: string, source: PspSource): Promise<void>;
  /** Stub for future tax/MoR routing — see A10 */
  selectPspForNewSubscription(input: {
    billingCountry?: string | null;
    existingSource?: PspSource | null;
  }): PspSource;
}
```

Constraints:

- Lives in `@vmp/payments` (or `packages/payments/src/middleware/`) — **no Nuxt imports**
- Composition root in `packages/api/src/paymentProviders.ts` (or new `billingMiddleware.ts`) injects D1 + Flag evaluator + PostHog capture
- Qerko `create*` throws if Flagship `legacy_migration` is false
- Stripe is default for new subscriptions
- Lifecycle events: `subscription_created` / `subscription_cancelled` / `subscription_renewed` / `subscription_checked` (align names with existing `subscription_activated` etc. — prefer **extend** existing event names rather than rename analytics)

---

## Phased delivery (one PR per phase)

### Phase 0 — Plan + roadmap (this PR)

- [x] This document
- [ ] `ROADMAP.md` entries
- [ ] Ambiguities A1–A11 listed for maintainer

### Phase A — Flagship plumbing (API first)

1. Add `flagship` binding to `packages/api/wrangler.json` (app_id from env / placeholder).
2. Introduce `packages/api/src/flagshipFlags.ts` (or shared) wrapping `env.FLAGS` with default `false`.
3. Parallel-read period: evaluate Flagship **if binding present**, else fall back to `VMP_FEATURES` parser (temporary). Document cutover checklist.
4. Unit tests with mock `FLAGS` binding.
5. **Do not** remove `VMP_FEATURES` yet.

*Depends on:* Flagship app_id (A2).

### Phase B — Replace all `VMP_FEATURES` reads

1. API `routeFeatureGuard` + admin manifest → Flagship only.
2. Web: stop baking allowlist from env; hydrate from API manifest / SSR Flagship (A3).
3. Remove deploy `--var VMP_FEATURES`, GitHub var docs, `.env.example` entries.
4. Update tests, `packages/features/README.md`, deprecate compile-time sections in [deployment-feature-modules.md](./deployment-feature-modules.md).
5. Success: `rg VMP_FEATURES` only hits historical docs / changelog if any.

*Ops gate:* All production/staging flags enabled in Flagship before merge.

### Phase C — PostHog SSR flag readiness

1. Shared Nuxt server PostHog client with `getFeatureFlag` / `getAllFlags` helpers.
2. Document known SSR issues (consent, no `before_send` on module serverConfig, 5xx-only exception plugin).
3. Optional: API Worker `getFeatureFlag` helper for future use.
4. **No** PostHog flags created; **no** product call sites.

### Phase D — Payment middleware skeleton

1. Add types + `PaymentMiddleware` + `NotImplementedError` MoR/country router stub in `@vmp/payments`.
2. Implement Stripe + Qerko adapters behind middleware (wrap existing providers).
3. GoPay/Comgate: stub path at middleware (A6).
4. Wire API composition root; migrate `paymentProcessor` checkout/cancel/get paths incrementally.
5. Emit PostHog lifecycle events with `psp_source` from middleware (all providers that fire).
6. Gate Qerko create with Flagship `legacy_migration`.
7. **No** subscriber migration; **no** price changes; **flag** any schema change (A7).

### Phase E — Product layer cleanup

1. Ensure entitlement checks (`hasAccess`, etc.) go through middleware `hasSubscription` / shared entitlement helper where appropriate.
2. Audit: no Stripe/Qerko/GoPay/Comgate imports outside adapters (+ documented Stripe.js web exception).
3. Shrink direct `stripeClient.ts` usage into Stripe adapter.

---

## Explicit non-goals

- Activating GoPay or Comgate in production
- Creating PostHog feature flags or experiments
- Changing prices or billing amounts
- Migrating existing subscriber rows
- Silent D1 schema changes (must be flagged — A7)
- Pushing to `main` / skipping CodeRabbit PR review

## Testing strategy (per phase)

| Phase | Automated | Manual / ops |
|-------|-----------|--------------|
| A | Mock Flagship binding unit tests; existing route guard tests updated | Confirm Flagship app evaluates in `wrangler dev` |
| B | Shared/API/web deployment-feature tests rewritten for evaluator | Staging smoke: payments, admin tabs, PWA after cutover |
| C | Unit test PostHog server helper with mocked `posthog-node` | N/A for flags |
| D–E | Payments package tests + API payment tests; PostHog event assertions with `psp_source` | Stripe checkout smoke; Qerko create blocked when flag off |

## Success criteria (checklist)

- [ ] `VMP_FEATURES` not read by application code or deploy scripts
- [ ] Infra toggles evaluated via Flagship with code default `false`
- [ ] `legacy_migration` gates Qerko **new** subscription creation
- [ ] Product layer calls payment middleware, not PSP SDKs (Stripe.js web exception documented)
- [ ] GoPay/Comgate cannot be accidentally activated for new subs without keys + explicit future work
- [ ] PostHog SSR can evaluate flags (helper present); no product flags created yet
- [ ] Existing behaviour preserved when Flagship mirrors today’s allowlist

## Related docs

- [deployment-feature-modules.md](./deployment-feature-modules.md)
- [payments-gopay-comgate.md](./payments-gopay-comgate.md)
- [analytics-observability.md](./analytics-observability.md)
- [packages/payments/README.md](../../packages/payments/README.md)
- Cloudflare Flagship: https://developers.cloudflare.com/flagship/
