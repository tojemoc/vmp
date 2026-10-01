# Flagship infrastructure flags + payment middleware

Roadmap IDs: `infra-flagship-flags`, `payment-middleware`

## Goal

1. Replace the `VMP_FEATURES` env-var allowlist with **Cloudflare Flagship** boolean flags (Tier 1 infrastructure toggles).
2. Ensure **PostHog** server-side SDK setup on Nuxt SSR is ready for future product/experiment flags (Tier 2) — **do not create PostHog flags yet**.
3. Introduce a **product payment middleware** above the existing `@vmp/payments` provider adapters so the rest of the product never imports PSP clients directly — structured so billing can later move to a **dedicated Worker**.

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

## Locked decisions

| ID | Decision |
|----|----------|
| **A1** | Runtime Flagship gates; always register web modules; no-op when flag off. Slim tree-shaking is a later optional profile, not `VMP_FEATURES`. |
| **A2** | **One Flagship app for staging** now; add a prod app later if needed. Create app + enable current allowlist **before** Phase B cutover. Agent environments lack `CLOUDFLARE_API_TOKEN` — maintainer runs `wrangler flagship apps create`. |
| **A3** | Flagship on **API only**; web hydrates via deployment-features / bootstrap endpoint. |
| **A4** | Keep `gtm` as a Flagship infra flag. |
| **A5** | `FlagEvaluator` + mock for tests; optional `FLAGSHIP_DEV_OVERRIDE` in `.dev.vars` only (not named `VMP_FEATURES`). |
| **A6** | **Soft-disable** GoPay/Comgate: keep provider code; middleware will not route new subscriptions unless `isConfigured()` **and** explicitly enabled later. No hard always-throw stub. |
| **A7** | **Public / middleware naming is `qerko`** (not `legacy`). Stop exposing `legacy` as an API provider id. D1 may keep storing `legacy` via existing `providerIdToDbProvider` mapping until a **flagged** data migration renames rows — **no silent schema/data migration in Phase D**. |
| **A8** | Stripe.js in web is an allowed exception (Elements). |
| **A9** | Middleware is product API; checkout may return `clientSecret` / `checkoutUrl`; prefer `userId` from auth. |
| **A10** | **Defer MoR / country routing.** Prefer validating a **dedicated billing Worker** extractability path first (see below). New subs default to Stripe until that design lands. |
| **A11** | Add PostHog SSR flag helpers in Phase C; no product flags yet. |

### Still open (non-blocking)

- **A3 detail:** public vs admin-only bootstrap endpoint for web flag hydration (Phase B).
- **A7 data migration:** optional later PR to rename D1 `legacy` → `qerko` (flagged, not scheduled).
- **Flagship app_id:** maintainer creates staging app (commands below).

### Flagship app creation (ops)

```bash
cd packages/api
npx wrangler flagship apps create vmp-api-staging --binding FLAGS --update-config
# Create boolean flags (Wrangler default: off) for each DEPLOYMENT_FEATURE_IDS entry
# Enable the staging allowlist before Phase B merge
```

---

## Billing Worker extractability (near-term design focus; replaces MoR stub)

### Why this matters more than MoR now

MoR / country routing only pays off once tax policy and a second live PSP (or MoR vendor) exist. Meanwhile payment risk already spans adapters, API composition, webhooks, renewal cron, and secrets on the same Worker as auth/CMS/media proxy.

A **slim, independently auditable billing Worker** is the stronger near-term bet: smaller audit surface, isolated PSP secrets, independent deploy/rollback, and a natural home for `PaymentMiddleware`.

### Recommended shape

```text
Web ──▶ API Worker (auth, catalog, entitlements, CMS, …)
              │ service binding / internal auth
              ▼
        Billing Worker
              │ owns: checkout, cancel, portal, webhooks, renewals
              │ owns: PSP secrets + PaymentMiddleware + adapters
              ▼
           PSPs + D1 (subscription writes)
```

**Entitlements stay on the API Worker** initially by **reading shared D1** (`subscriptions` status/plan). Billing Worker is the **writer** and the only process that talks to PSPs. That avoids RPC on every `video-access` while concentrating audit risk on the write/PSP path.

### Phase D design constraints (prove extractability without extracting yet)

1. `PaymentMiddleware` lives in `@vmp/payments` with injected deps (`db`, `flags`, `capturePostHog`) — **zero** imports from `packages/api` or Nuxt.
2. API composition root only wires env → middleware; HTTP handlers stay thin.
3. Webhook + cron paths call the same middleware entrypoints as HTTP handlers.
4. Qerko **create** gated by Flagship `legacy_migration` inside middleware.
5. Public provider id is **`qerko`**; DB `legacy` mapping stays in `@vmp/payments` `ids.ts`.

### What we will not do yet

- Stub MoR country routing (`selectPspForNewSubscription` returns `'stripe'` for new subs, or is omitted until needed).
- Spin up the billing Worker in Phase D — Phase D proves the boundary; **Phase F** extracts the Worker + service binding if the decision gate passes.

### Decision gate (after Phase D)

- Is the audit boundary clean enough that a separate Worker is worth the ops cost?
- Are webhook URLs / portal return URLs easy to re-point?
- Does shared-D1-read for entitlements satisfy compliance, or must reads move too?

If yes → Phase F. If no → keep middleware co-located; introduce MoR only when a vendor/policy exists.

---

## Target architecture

```text
                    ┌─────────────────────┐
                    │ Cloudflare Flagship │
                    │  (infra booleans)   │
                    └──────────┬──────────┘
                               │ env.FLAGS (API Worker)
                               ▼
Web --> API Worker (auth, catalog, entitlements, thin payment HTTP)
              |
              |  Phase D: in-process call
              |  Phase F: service binding to billing Worker
              v
        PaymentMiddleware (@vmp/payments) -- Nuxt-free, Worker-extractable
              |
              +--> StripeAdapter (live)
              +--> QerkoAdapter (legacy_migration gate)
              +--> GoPay/Comgate (soft-disabled)
              |
              +--> PostHog lifecycle events (psp_source)
```

### Flag catalog (Tier 1 — Flagship keys = existing IDs)

`gtm`, `posthog`, `pwa`, `push`, `payments`, `cms`, `analytics`, `newsletter`, `einvoicing`, `legacy_migration`, `rss_podcast`, `rss_podcast_preview_mp3`, `pills`, `deno_replication`.

Code default: `getBooleanValue(id, false)` always.

### Payment middleware interface (draft)

```ts
export type PspSource = 'stripe' | 'qerko' | 'gopay' | 'comgate' | 'mor';

export interface PaymentMiddleware {
  hasSubscription(email: string): Promise<{ active: boolean; source: PspSource }>;
  getSubscription(email: string): Promise<SubscriptionRecord | null>;
  createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult>;
  cancelSubscription(email: string, source: PspSource): Promise<void>;
}
```

Constraints:

- Lives in `@vmp/payments` — **no Nuxt imports**, no `@vmp/api` imports
- Composition root injects D1 + Flag evaluator + PostHog capture
- Qerko `create*` throws if Flagship `legacy_migration` is false
- Stripe is the default PSP for all new subscriptions
- GoPay/Comgate: soft-disable (configured + future enable path); do not delete provider code
- Lifecycle events keep existing names where possible (`subscription_activated`, etc.) and always include `psp_source: PspSource`
- `mor` remains in the type union as a reserved source; no MoR adapter until Phase F+ policy

---

## Phased delivery (one PR per phase)

### Phase 0 — Plan + roadmap

- [x] This document + locked decisions
- [x] `ROADMAP.md` / `AGENTS.md` entries
- [x] Billing-Worker extractability analysis (A10 pivot)

### Phase A — Flagship plumbing (API first)

1. Introduce `FlagEvaluator` (`packages/api/src/infraFlags.ts` or similar): Flagship binding → default `false`; temporary fallback to `VMP_FEATURES`; `FLAGSHIP_DEV_OVERRIDE` for local.
2. Make route guards / manifest evaluation **async** (Flagship API is async).
3. Unit tests with mock evaluator / mock `FLAGS`.
4. Document ops steps for `wrangler flagship apps create vmp-api-staging`.
5. Add `flagship` binding to `wrangler.json` **once** `app_id` exists (or leave commented with placeholder until ops).
6. **Do not** remove `VMP_FEATURES` yet.

### Phase B — Replace all `VMP_FEATURES` reads

1. API route guard + admin manifest → Flagship only (fallback removed).
2. Web: stop baking allowlist from env; hydrate from API (A1 + A3).
3. Remove deploy `--var VMP_FEATURES`, GitHub var docs, `.env.example` entries.
4. Update tests + feature-module docs.

*Ops gate:* Staging Flagship flags enabled to match today’s allowlist before merge.

### Phase C — PostHog SSR flag readiness

1. Shared Nuxt server PostHog client with `getFeatureFlag` / `getAllFlags` helpers.
2. Document known SSR issues (consent, no `before_send` on module serverConfig, 5xx-only exception plugin).
3. **No** PostHog flags created; **no** product call sites.

### Phase D — Payment middleware (Worker-extractable, in-process)

1. `PaymentMiddleware` in `@vmp/payments` + Stripe/Qerko adapters.
2. GoPay/Comgate soft-disabled at middleware router.
3. Wire API composition root; migrate checkout/cancel/get paths incrementally.
4. PostHog lifecycle events with `psp_source` (`qerko` naming on the wire).
5. Gate Qerko create with Flagship `legacy_migration`.
6. **No** MoR stub; **no** subscriber row migration; **no** price changes.

### Phase E — Product layer cleanup

1. Entitlement helpers prefer shared subscription read helpers (still D1 on API).
2. Audit: no PSP imports outside adapters (+ Stripe.js web exception).
3. Fold remaining `stripeClient.ts` usage into Stripe adapter.

### Phase F — Optional billing Worker extract (decision gate)

1. New Worker package binding `@vmp/payments` middleware + PSP secrets.
2. API → billing via service binding for checkout/cancel/portal/webhooks.
3. D1 subscription **writes** only from billing; **reads** remain on API initially.
4. Re-point webhook URLs; smoke Stripe + Qerko manage paths.

---

## Explicit non-goals

- Activating GoPay or Comgate for new subscribers without an explicit later decision
- Creating PostHog feature flags or experiments
- Changing prices or billing amounts
- Migrating existing subscriber rows (including `legacy` → `qerko` in D1) without a dedicated flagged PR
- MoR / country tax routing stubs before billing-Worker decision
- Pushing to `main` / skipping CodeRabbit PR review

## Testing strategy (per phase)

| Phase | Automated | Manual / ops |
|-------|-----------|--------------|
| A | Mock Flagship / evaluator unit tests; async route guard tests | Maintainer creates Flagship app; `wrangler dev` eval |
| B | Shared/API/web feature tests rewritten for evaluator | Staging smoke after flags enabled |
| C | Unit test PostHog server helper with mocked `posthog-node` | — |
| D–E | Payments + API tests; PostHog `psp_source` assertions | Stripe checkout; Qerko create blocked when flag off |
| F | Contract tests across service binding | Staging webhook + checkout smoke on billing Worker |

## Success criteria (checklist)

- [ ] `VMP_FEATURES` not read by application code or deploy scripts
- [ ] Infra toggles evaluated via Flagship with code default `false`
- [ ] `legacy_migration` gates Qerko **new** subscription creation
- [ ] Product layer calls payment middleware, not PSP SDKs (Stripe.js web exception documented)
- [ ] Public PSP naming uses `qerko` (not `legacy`)
- [ ] GoPay/Comgate soft-disabled for accidental new-sub activation
- [ ] `@vmp/payments` middleware free of Nuxt/API imports (extract-ready)
- [ ] PostHog SSR can evaluate flags (helper present); no product flags created yet
- [ ] Existing behaviour preserved when Flagship mirrors today’s allowlist

## Related docs

- [deployment-feature-modules.md](./deployment-feature-modules.md)
- [payments-gopay-comgate.md](./payments-gopay-comgate.md)
- [analytics-observability.md](./analytics-observability.md)
- [packages/payments/README.md](../../packages/payments/README.md)
- Cloudflare Flagship: https://developers.cloudflare.com/flagship/
