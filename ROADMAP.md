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
5. **Issues** — Each backlog section links a GitHub issue. Open a new issue (or split from a closed umbrella issue) before coding if none exists.

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

---

## In progress

| ID | Item | PR / branch |
|----|------|-------------|
| `payments-gopay-comgate` | GoPay + Comgate draft providers ([#648](https://github.com/tojemoc/vmp/issues/648)) | [PR #499](https://github.com/tojemoc/vmp/pull/499) (supersedes closed #442) |

### `payments-gopay-comgate` sub-items

- [ ] Provider registry + admin pricing
- [ ] Comgate first-checkout identity + renewals
- [ ] GoPay redirect checkout + recurrence
- [ ] Qerko legacy club → `subscriptionType: club` (not yearly)
- [ ] Production hardening + maintainer sign-off

*Check off sub-items and add the merged PR link when [PR #499](https://github.com/tojemoc/vmp/pull/499) lands on `main`.*

---

## Backlog

### CMS admin analytics (`analytics-observability-cms`)

**Plan:** [docs/plans/analytics-observability.md](docs/plans/analytics-observability.md) — [#643](https://github.com/tojemoc/vmp/issues/643) (split from closed #452; canonical stack shipped in [#642](https://github.com/tojemoc/vmp/pull/642))

- [ ] CMS admin analytics expansion (views, referrer, country)

### Step 8 — Brevo newsletter sync (`step-08`)

**Plan:** [docs/plans/step-08-brevo-newsletter.md](docs/plans/step-08-brevo-newsletter.md) — [#645](https://github.com/tojemoc/vmp/issues/645)

- [ ] Brevo subscriber sync on subscribe/renewal
- [ ] Remove on cancellation
- [ ] Admin Newsletter tab + campaign send
- [ ] `brevo_subscriber_list_id` setting

### Step 9 — RSS / podcast feed (`step-09`)

**Plan:** [docs/plans/step-09-rss-podcast-feed.md](docs/plans/step-09-rss-podcast-feed.md) — [#644](https://github.com/tojemoc/vmp/issues/644)

- [ ] Personal RSS feed (HMAC token + active subscription)
- [ ] Public preview-only feed
- [ ] Account RSS helper + UI

### Step 10 — Self-service account deletion (`step-10`)

**Blocked:** payment gateway adapter — immediate cancellation across providers.

**Plan:** [docs/plans/step-10-account-deletion.md](docs/plans/step-10-account-deletion.md) — [#646](https://github.com/tojemoc/vmp/issues/646) (spec #506 closed; implementation tracked here)

- [ ] See checklist in plan (deletion jobs, invoices, Brevo, UI, checkout consent)

### Club plan entitlements (`club`)

**Product:** Yearly billing + higher price; IRL event access; ad-free if ads exist; **2–3 concurrent streams** (Stargaze had 1).  
**Plan:** [docs/plans/club-plan-entitlements.md](docs/plans/club-plan-entitlements.md) — [#649](https://github.com/tojemoc/vmp/issues/649)

- [ ] Concurrent playback session limits (default 1, club 3) — **priority**
- [ ] IRL event invitations / access
- [ ] Ad-free gate (when ad insertion exists)

**Not club entitlements:** `offline_device_limit_club` is for offline download device registration only.

### Native / TV clients (`native-clients`)

**Plan:** [docs/native-clients-plan.md](docs/native-clients-plan.md) — [#647](https://github.com/tojemoc/vmp/issues/647); Phase 0 + Tier 1 scaffold in repo.

- [ ] (Track milestones in native-clients plan; add sub-items here when scheduling)

---

## Adding new work

1. Add a row or checkbox section with a stable **ID** (`kebab-case`).
2. Add `docs/plans/<id>.md` if the work needs more than a few bullets.
3. Link both ways (plan ↔ roadmap).
4. Implement via PR; check off here when merged.
