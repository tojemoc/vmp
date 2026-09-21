# Mobile access tiers — subscriber gate → web parity

**Roadmap IDs:** `mobile-subscriber-gate`, `mobile-access-tiers`  
**Parent:** [Native / TV clients](../native-clients-plan.md) (`native-clients`, [#647](https://github.com/tojemoc/vmp/issues/647))  
**Related web behaviour:** `GET /api/video-access`, anonymous rate limits, `useAuth().isPremium`

## Goal

Align native entitlement UX with the web product over time, without shipping full free/anonymous browsing in the first mobile cut.

## Milestone A — App-level subscriber gate (`mobile-subscriber-gate`) — **this PR**

**Product:** The Expo app is usable (catalog, watch, offline downloads, TV pairing approve) **only** for active paying subscribers (and staff roles that already get synthetic premium via `GET /api/account/subscription`).

| Actor | Behaviour |
| --- | --- |
| Signed-out | Login only |
| Signed-in, no active/trialing sub (or expired `currentPeriodEnd`) | Lock screen: explain subscription required; deep-link / open web `/pricing` (and Settings → sign out) |
| Signed-in, active monthly/yearly/club (or staff) | Full catalog + watch + downloads |

**Implementation notes**

- Entitlement source: `GET /api/account/subscription` (same as web), mirrored by role ≠ viewer fallback consistent with `useAuth().isPremium`.
- Feature flag: `EXPO_PUBLIC_REQUIRE_ACTIVE_SUBSCRIPTION` (`1` / `true` default when unset). Flip to `0` only when Milestone B ships.
- Do **not** reimplement payment checkout in-app in Milestone A — send users to the web pricing / account flow.
- Offline downloads remain premium-only (already true on the API).

**Out of scope for A:** anonymous browsing, free-logged-in preview playback, in-app Stripe Checkout.

## Milestone B — Web-parity access tiers (`mobile-access-tiers`) — roadmap

Reuse the same API contracts as `@vmp/web`:

1. **Anonymous** — browse catalog; `GET /api/video-access/{videoId}` without JWT; preview-truncated playlist; anonymous rate limit (`429` + login prompt).
2. **Logged-in free** — no hourly anon limit; still preview-only (`hasAccess: false` when preview &lt; full).
3. **Active subscriber / staff** — full playlist; offline authorize; concurrent-stream limits when club entitlements ship.

**Client work when unlocking B**

- Set `EXPO_PUBLIC_REQUIRE_ACTIVE_SUBSCRIPTION=0`.
- Home + watch consume `hasAccess`, `chapters`, and preview end from video-access (Premium overlay / “Subscribe” CTA instead of app-wide lock).
- Optional: anonymous session mode (no SecureStore tokens) for browse-only.
- Keep Settings / magic-link / pairing flows for signed-in users.

**Acceptance (B)**

- Non-subscriber can open a video and play only through `previewDuration`.
- Hitting preview end shows subscribe CTA linking to web pricing.
- Anonymous rate-limit UI matches web copy intent (sign-in to continue).

## Decision log

- **2026-09:** Ship hard subscriber gate first so SideStore / internal testers match paying-customer reality; plan free/preview parity as a deliberate second milestone behind the existing feature flag.
