# Implementation plans

Detailed specs for items on the [ROADMAP.md](../../ROADMAP.md) checklist. Agents should read the relevant plan before coding and update the roadmap when a PR ships.

Each backlog item links a **GitHub tracking issue** in `ROADMAP.md`. PRs should include `Closes #<issue>` so the issue auto-closes on merge.

| Plan | Roadmap section | Issue |
|------|-----------------|-------|
| [analytics-observability.md](analytics-observability.md) | CMS admin analytics (`analytics-observability-cms`) — in progress | [#643](https://github.com/tojemoc/vmp/issues/643) / TOJ-135 |
| [club-plan-entitlements.md](club-plan-entitlements.md) | Club plan — product entitlements — in progress | [#649](https://github.com/tojemoc/vmp/issues/649) / TOJ-139 |
| [payments-gopay-comgate.md](payments-gopay-comgate.md) | GoPay + Comgate — **shipped** (live smoke ops) | [#648](https://github.com/tojemoc/vmp/issues/648) / TOJ-141 |
| [step-08-brevo-newsletter.md](step-08-brevo-newsletter.md) | Step 8 — Brevo newsletter sync — **shipped** | [#645](https://github.com/tojemoc/vmp/issues/645) / TOJ-138 (closed) |
| [step-09-rss-podcast-feed.md](step-09-rss-podcast-feed.md) | Step 9 — RSS / podcast feed — **shipped** | [#644](https://github.com/tojemoc/vmp/issues/644) / TOJ-137 (closed) |
| [step-10-account-deletion.md](step-10-account-deletion.md) | Step 10 — Self-service account deletion — in progress (groundwork) | [#646](https://github.com/tojemoc/vmp/issues/646) / TOJ-136 |
| [mobile-access-tiers.md](mobile-access-tiers.md) | Native — subscriber gate → web-parity tiers | [#647](https://github.com/tojemoc/vmp/issues/647) |
| [mobile-cms-parity.md](mobile-cms-parity.md) | Native — thumbnails/watch → CMS blocks + articles | [#647](https://github.com/tojemoc/vmp/issues/647) |
| [tv-tier2-sprint.md](tv-tier2-sprint.md) | Native — TV Sprint 0 (D-pad + pairing) | [#647](https://github.com/tojemoc/vmp/issues/647) |

Other long-running designs outside this folder:

- [native-clients-plan.md](../native-clients-plan.md) — native / TV clients (multi-tier plan)
- [archive/offline-downloads-roadmap.md](../archive/offline-downloads-roadmap.md) — offline downloads (shipped M1–M6)
