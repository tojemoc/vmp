# Documentation index

Start with the [repository README](../README.md), [AGENTS.md](../AGENTS.md), and [ROADMAP.md](../ROADMAP.md). This folder holds API notes and historical design write-ups.

## Implementation plans

| Document | Description |
| --- | --- |
| [plans/README.md](plans/README.md) | Index of detailed specs linked from the roadmap |
| [plans/club-plan-entitlements.md](plans/club-plan-entitlements.md) | Club plan — concurrent playback, IRL events, ad-free |
| [plans/step-08-brevo-newsletter.md](plans/step-08-brevo-newsletter.md) | Brevo newsletter sync |
| [plans/step-09-rss-podcast-feed.md](plans/step-09-rss-podcast-feed.md) | RSS / podcast feeds |
| [plans/step-10-account-deletion.md](plans/step-10-account-deletion.md) | Self-service account deletion |

## Current

| Document | Description |
| --- | --- |
| [native-clients-plan.md](native-clients-plan.md) | Multi-tier native/TV client plan (Expo → tvOS/Android TV → Tizen/webOS) + Phase 0 API contracts |
| [native-clients-promotion-checklist.md](native-clients-promotion-checklist.md) | Blocking checklist before workspace promotion / TestFlight |
| [ios-sidestore-distribution-playbook.md](ios-sidestore-distribution-playbook.md) | SideStore / AltStore test IPA distribution (GitHub Releases + Pages) |

Generated (do not commit): `altstore-source.json` is produced by `scripts/generate-altstore-source.py` from `altstore-source.meta.json` during CI or local runs.
| [pills-external-update-api.md](pills-external-update-api.md) | `POST /api/pills/update` external API contract |
| [console-errors.md](console-errors.md) | Common browser console messages and how to interpret them |
| [i18n-prep.md](i18n-prep.md) | Per-instance UI locale (`NUXT_PUBLIC_UI_LOCALE`) and translation workflow |

Related (outside `docs/`):

| Document | Description |
| --- | --- |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | CI/CD, env vars, smoke checks |
| [../packages/web/docs/workers-deploy-env.md](../packages/web/docs/workers-deploy-env.md) | Web Worker build-time environment |
| [../packages/web/docs/workers-pages-compatibility.md](../packages/web/docs/workers-pages-compatibility.md) | Workers vs deprecated Pages routing notes |

## Archive (historical / planning)

These are kept for context. They are **not** the source of truth for current behavior.

| Document | Notes |
| --- | --- |
| [archive/admin-homescreen-layout-redesign.md](archive/admin-homescreen-layout-redesign.md) | Homescreen editor redesign plan |
| [archive/offline-downloads-roadmap.md](archive/offline-downloads-roadmap.md) | Offline downloads milestones (M1–M6 shipped) |
| [archive/stripe-express-checkout-investigation.md](archive/stripe-express-checkout-investigation.md) | Stripe Express Checkout investigation notes |
