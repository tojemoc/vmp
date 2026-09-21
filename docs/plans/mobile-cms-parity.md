# Mobile CMS + watch surface parity

**Roadmap IDs:** `mobile-thumbnails-watch`, `mobile-cms-parity`  
**Parent:** [Native / TV clients](../native-clients-plan.md) (`native-clients`, [#647](https://github.com/tojemoc/vmp/issues/647))  
**Web references:** `VideoCard.vue`, `pages/watch/[videoId].vue`, `useHomepageLayout.ts`, `CmsBlockRenderer.vue`, `GET /api/homepage/*`, `GET /api/pages/:slug`

## Goal

Make the phone/tablet catalog and watch experience feel like the PWA: real thumbnails, richer watch chrome, then the same CMS-driven homepage blocks and text articles.

## Milestone A — Thumbnails + watch chrome (`mobile-thumbnails-watch`) — **shipped [#692](https://github.com/tojemoc/vmp/pull/692)**

| Surface | Deliverable |
| --- | --- |
| Home catalog | Show `thumbnail_url` (prefer `small` / `medium` size token swap, same R2 layout as web) |
| Catalog row | Duration badge; optional PRO hint when `preview_duration` &lt; full (informational; gate may still hide free users) |
| Watch | Title, description (expand/collapse), duration / access badge, player, offline panel |
| Watch “Up next” | `GET /api/recommendations?videoId=` horizontal list with thumbs |

**Out of scope for A:** full media-chrome control parity, MoQ livestream UI, playback resume UI polish, markdown description rendering (plain text / simple truncate is enough).

## Milestone B — CMS homepage + articles (`mobile-cms-parity`) — roadmap

### B1 — Homepage blocks (grid + layout)

Consume public homepage APIs already used by Nuxt:

- `GET /api/homepage/content` (or placement + videos bundle used by web)
- Reuse block type model from `useHomepageLayout` (`featured_row`, `category`, `top_video`, splits, `page_banner`, mobileOrder / mobileHidden)

Native work:

- Port layout resolution to a shared-friendly TS module under `apps/mobile` (or later `@vmp/shared` if both clients need identical rules).
- Render block list with RN primitives (FlashList / FlatList sections) — **not** a WebView of the PWA.
- Honour `mobileHidden` / `mobileOrder` the same way web’s mobile breakpoints do.

### B2 — Text articles / CMS pages

- `GET /api/pages/:slug` for published pages (banners already deep-link by `pageSlug`).
- Native article screen: title, description, rendered body (markdown → RN-safe components or constrained WebView only if necessary).
- Entry points: homepage `page_banner` taps, Settings “Legal / About” links, future in-app browser for external URLs only.

### Acceptance (B)

- Rearranging blocks in admin CMS changes the native home without an app release (API-driven).
- A published CMS page opens in-app and is readable offline-cache optional (online-first OK for first cut).

## Decision log

- **2026-09:** Ship thumbs + watch chrome before full CMS so catalog/watch stop looking like a debug list; CMS/articles tracked as explicit follow-up under native-clients.
