# VMP Roadmap

Living checklist for humans and coding agents. **Architecture, auth, and runtime rules stay in [AGENTS.md](AGENTS.md).** This file tracks *what to build next* and what shipped.

## How to use this file

### For humans

- Pick an unchecked item or milestone.
- Open the linked plan under [docs/plans/](docs/plans/) for implementation detail.
- Ship via feature branch + PR (never push to `main`).

### For agents (required)

1. **Before coding** — Read this file and the plan linked from your task. If the task is not on the roadmap, add a one-line entry and a `docs/plans/<topic>.md` spec first (same PR or a preceding docs-only PR).
2. **Scope** — One PR per roadmap item or tight sub-item (see [AGENTS.md — Git workflow](AGENTS.md#git-workflow-mandatory--read-first)).
3. **PR description** — Cite roadmap IDs (e.g. `club-concurrent-playback`) and list which checklist lines the PR completes. Link the tracking issue with `Closes #<issue>` so GitHub auto-closes it on merge.
4. **After merge** — Update this file: change `[ ]` to `[x]` and add the PR link on the same line. Do not mark items done in a PR that only partially implements the plan unless the plan explicitly splits deliverables.
5. **Issues** — Each backlog section links a GitHub issue (and Linear `TOJ-*` where synced). Open a new issue (or split from a closed umbrella issue) before coding if none exists.

---

## Shipped (foundation)

| ID | Item | Notes |
|----|------|-------|
| `step-01` | Video draft/publish flow | |
| `step-02` | Anonymous rate limiting | |
| `step-03` | Stripe payments | |
| `step-04` | Signed segment URLs + yt-dlp throttling | |
| `step-05` | 2FA for editor+ roles | |
| `step-06` | PWA + push notifications | Push has known issues |
| `step-07` | Thumbnail management | |
| `playback-resume` | Playback position resume (#488) | `playback_positions` table; see code + AGENTS history |
| `offline-downloads` | Offline downloads (PWA) (#385) | M1–M6 shipped [#387](https://github.com/tojemoc/vmp/pull/387), [#398](https://github.com/tojemoc/vmp/pull/398); follow-ups [#418](https://github.com/tojemoc/vmp/pull/418), [#419](https://github.com/tojemoc/vmp/pull/419), [#431](https://github.com/tojemoc/vmp/pull/431), [#492](https://github.com/tojemoc/vmp/pull/492). Spec: [docs/archive/offline-downloads-roadmap.md](docs/archive/offline-downloads-roadmap.md) |
| `analytics-observability` | Canonical analytics stack (#452, #509, #512, #611) | [#642](https://github.com/tojemoc/vmp/pull/642); plan: [analytics-observability.md](docs/plans/analytics-observability.md) |
| `step-08` | Brevo newsletter sync (#645 / TOJ-138) | Opt-out model + sync + admin tab shipped [#665](https://github.com/tojemoc/vmp/pull/665); plan: [step-08-brevo-newsletter.md](docs/plans/step-08-brevo-newsletter.md). Staging smoke with live `BREVO_API_KEY` is maintainer ops. |
| `step-09` | RSS / podcast feed (#644 / TOJ-137) | Personal + public feeds, revocable token, account UI [#653](https://github.com/tojemoc/vmp/pull/653); plan: [step-09-rss-podcast-feed.md](docs/plans/step-09-rss-podcast-feed.md) |
| `deployment-feature-modules` | Compile-time `VMP_FEATURES` modules | Phases 1–4 shipped ([#652](https://github.com/tojemoc/vmp/pull/652)+); plan: [deployment-feature-modules.md](docs/plans/deployment-feature-modules.md) |

---

## In progress

### GoPay + Comgate production hardening (`payments-gopay-comgate`)

**Issues:** [#648](https://github.com/tojemoc/vmp/issues/648) / [TOJ-141](https://linear.app/tojemoc/issue/TOJ-141)

Providers + checkout analytics shipped. Only production hardening + maintainer sign-off remain.

- [x] Provider registry + admin pricing ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] Comgate first-checkout identity + renewals ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] GoPay redirect checkout + recurrence ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] Qerko legacy club → `subscriptionType: club` (not yearly) ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] Checkout analytics for GoPay + Comgate start/return ([#654](https://github.com/tojemoc/vmp/pull/654))
- [ ] Production hardening + maintainer sign-off

### Club plan entitlements (`club`)

**Issues:** [#649](https://github.com/tojemoc/vmp/issues/649) / [TOJ-139](https://linear.app/tojemoc/issue/TOJ-139)  
**Plan:** [docs/plans/club-plan-entitlements.md](docs/plans/club-plan-entitlements.md)

**Product:** Yearly billing + higher price; IRL event access; ad-free if ads exist; **2–3 concurrent streams** (Stargaze had 1).

- [x] Concurrent playback **API** (D1 `playback_sessions`, mint/heartbeat/release, `video-access` enforce, tests) — [#655](https://github.com/tojemoc/vmp/pull/655), [#661](https://github.com/tojemoc/vmp/pull/661); flag `concurrent_playback_enforced=0` by default
- [ ] Web player session mint + heartbeats + limit error UI (required before flipping the enforce flag)
- [ ] IRL event invitations / access
- [ ] Ad-free gate (when ad insertion exists)

**Not club entitlements:** `offline_device_limit_club` is for offline download device registration only.

### Step 10 — Self-service account deletion (`step-10`)

**Issues:** [#646](https://github.com/tojemoc/vmp/issues/646) / [TOJ-136](https://linear.app/tojemoc/issue/TOJ-136)  
**Plan:** [docs/plans/step-10-account-deletion.md](docs/plans/step-10-account-deletion.md) (spec #506 / TOJ-19 closed)

Groundwork landed in [#656](https://github.com/tojemoc/vmp/pull/656); full deletion flow in this PR:

- [x] `requireAuth` rejects tokens whose user row is gone
- [x] `einvoices.user_id` nullable + `ON DELETE SET NULL` (retention)
- [x] `offline_devices` / `offline_download_licenses` / `pwa_handoffs` `ON DELETE CASCADE`
- [x] Deletion-pending gate on auth / refresh / magic-link
- [x] Deletion token table + request/confirm API
- [x] Durable `account_deletion_jobs` + R2 object inventory
- [x] `cancelSubscriptionImmediately` on payment adapter
- [x] Invoice PII anonymization + Brevo contact deletion
- [x] Account deletion UI + legal copy
- [x] Checkout consent persistence (`checkout_consents`)

### CMS admin analytics (`analytics-observability-cms`)

**Issues:** [#643](https://github.com/tojemoc/vmp/issues/643) / [TOJ-135](https://linear.app/tojemoc/issue/TOJ-135)  
**Plan:** [docs/plans/analytics-observability.md](docs/plans/analytics-observability.md)

First-party video analytics already in admin (`/api/admin/analytics` + Analytics tab):

- [x] Per-video / aggregate **view counts**
- [x] **Referrer / traffic source** breakdown
- [x] **Country** (geo) breakdown (`CF-IPCountry` on segment proxy)
- [x] CMS **page** view counts (`POST /api/analytics/pageview` + `cms_page_view_*` D1 tables; Analytics KPI/table/CSV)

### Native / TV clients (`native-clients`)

**Issues:** [#647](https://github.com/tojemoc/vmp/issues/647) / [TOJ-140](https://linear.app/tojemoc/issue/TOJ-140)  
**Plan:** [docs/native-clients-plan.md](docs/native-clients-plan.md)

- [x] Phase 0 API contracts (native redeem, body refresh/logout, push register, device pairing)
- [x] Tier 1 Expo scaffold (`apps/mobile`) + SideStore distribution playbook
- [x] Client-tagged magic links (`client=browser|pwa|native` in email verify URL)
- [x] Native TOTP / 2FA UI (**S1**) — redeem → `/auth/2fa` → `POST /api/auth/2fa/verify` (refreshToken in body) ([#684](https://github.com/tojemoc/vmp/pull/684))
- [ ] Tier 1 PoC success criteria (handoff, push, catalog + watch, offline path end-to-end) — offline client wired in `apps/mobile` (authorize → filesystem → **loopback HTTP** → local play); still needs device E2E against R2-backed HLS + push delivery for full checkbox. Fixes: published-only catalog, offline entitlement cache, friendly offline copy, PWA offline abort (`mobile-offline-playback`)
- [ ] AASA / Digital Asset Links live values (`MOBILE_*` env vars)

#### Mobile entitlements (`mobile-subscriber-gate` → `mobile-access-tiers`)

**Plan:** [docs/plans/mobile-access-tiers.md](docs/plans/mobile-access-tiers.md)

- [x] App-level gate: catalog / watch / downloads / TV pairing approve only for active subscribers + staff (`mobile-subscriber-gate`) — [#692](https://github.com/tojemoc/vmp/pull/692)
- [ ] Web-parity tiers: anonymous (rate-limited) + logged-in free preview + subscriber full access (`mobile-access-tiers`)

#### Mobile catalog / watch / CMS (`mobile-thumbnails-watch` → `mobile-cms-parity`)

**Plan:** [docs/plans/mobile-cms-parity.md](docs/plans/mobile-cms-parity.md)

- [x] Catalog thumbnails + watch chrome closer to web (`mobile-thumbnails-watch`) — [#692](https://github.com/tojemoc/vmp/pull/692)
- [ ] CMS homepage blocks (grid / mobileOrder) on native (`mobile-cms-parity` B1)
- [ ] CMS text articles / pages in-app (`mobile-cms-parity` B2)

#### TV first sprint (`tv-tier2-sprint`)

**Plan:** [docs/plans/tv-tier2-sprint.md](docs/plans/tv-tier2-sprint.md)

- [ ] Pairing-code login on TV + D-pad focus catalog/watch (Sprint 0)
- [ ] Voice control / assistant intents (post–Sprint 0)
- [ ] Tier 2–4 (Android/tvOS → Tizen/webOS → Titan/VIDAA) + decision gate (Tier 5)

---

## Backlog (research / QA)

These are open Linear issues without active implementation milestones on the product roadmap above.

| Linear | GitHub | Title | Status note |
|--------|--------|-------|-------------|
| [TOJ-5](https://linear.app/tojemoc/issue/TOJ-5) | [#334](https://github.com/tojemoc/vmp/issues/334) | QA: AirPlay serves lock/preview manifest | AirPlay button exists on watch; **manual QA still needed** |
| [TOJ-6](https://linear.app/tojemoc/issue/TOJ-6) | [#337](https://github.com/tojemoc/vmp/issues/337) | QA: Miracast locked-video UX | Cast button exists; **manual QA still needed** |
| [TOJ-9](https://linear.app/tojemoc/issue/TOJ-9) | [#435](https://github.com/tojemoc/vmp/issues/435) | RFC: Backup stack (bunny.net / Backblaze) | Deno Deploy `@vmp/api-node` backup API exists; bunny/Backblaze investigation still open |
| [TOJ-14](https://linear.app/tojemoc/issue/TOJ-14) | [#441](https://github.com/tojemoc/vmp/issues/441) | Q: Inspired by peer streaming projects | Research only; MoQ livestreams + feature modules are related partial progress |

### Video startup latency (`video-startup-latency`)

**Plan:** [docs/plans/video-startup-latency.md](docs/plans/video-startup-latency.md) · encoding scale: [docs/plans/horizontally-scalable-encoding.md](docs/plans/horizontally-scalable-encoding.md)

Validated ~7s click-to-play (6s R2/CMAF segments via Worker proxy) vs ~3s on the old Bunny-edge stack.

- [ ] Path-keyed Workers Cache for immutable segments + ascending-bandwidth master rewrite + watch waterfall + above-fold prefetch (this PR)
- [ ] **2s segment duration** for new encodes (Encore GOP 60 + packager `segmentDuration: 2`; re-package existing catalog separately)
- [ ] **Horizontally scalable encoding** (Compose `docker-compose.scale.yml` high/low worker pools + packager replicas; optional segmented encode)
- [ ] Optional CDN (Bunny or R2 custom domain) once cacheable URL model allows
- [ ] PostHog `video_startup_ms` instrumentation

---

## Adding new work

1. Add a row or checkbox section with a stable **ID** (`kebab-case`).
2. Add `docs/plans/<id>.md` if the work needs more than a few bullets.
3. Link both ways (plan ↔ roadmap).
4. Implement via PR; check off here when merged.
