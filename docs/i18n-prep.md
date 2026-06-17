# i18n preparation (VMP web)

This document describes the string centralization pass and **per-instance localization** (one language per VMP deployment).

## Current approach

Viewer-facing UI copy lives in locale catalogs under [`packages/web/locales/`](../packages/web/locales/):

| Locale | Path | Use case |
|--------|------|----------|
| `en` | `locales/en/` | Default / international |
| `sk` | `locales/sk/` | Slovak VMP instance |
| `cs` | `locales/cs/` | Czech VMP instance |

Each catalog exports `strings` (UI copy) and `personalData` (GDPR transparency page at `/personal-data`).

Components import the active catalog via:

```ts
import strings from '~/utils/strings'
```

or reactively:

```ts
const { strings, personalData, locale, htmlLang } = useStrings()
```

Parameterized copy uses functions on the same object (for example `strings.rateLimitMessage(current, limit)`).

Admin dashboard copy is listed under `strings.admin` as an **inventory** for translators. `pages/admin/index.vue` (~6k lines) still embeds most admin strings inline; wiring that file is a separate follow-up.

## Per-instance locale (not in-app switching)

VMP is designed for **one language per deployment** — e.g. a Slovak client instance with `NUXT_PUBLIC_UI_LOCALE=sk`, a Czech client with `NUXT_PUBLIC_UI_LOCALE=cs`.

Set at build time in Cloudflare Pages / Vercel / local dev:

```bash
NUXT_PUBLIC_UI_LOCALE=sk API_URL=https://api.example.sk npm run build --workspace=@vmp/web
```

`runtimeConfig.public.uiLocale` and `<html lang="…">` follow this value. There is no language picker in the header by default.

To add an in-app switcher later, use `@nuxtjs/i18n` with locale-prefixed routes — not required for white-label instances.

## String inventory (approximate)

| Area | Keys in `strings.ts` | Wired in SFCs |
|------|----------------------|---------------|
| Site, header, roles, push | ~35 | Yes |
| Login, verify, PWA login | ~45 | Yes |
| 2FA (verify, setup, account) | ~40 | Yes |
| Homepage, category, watch | ~45 | Yes |
| Account, billing, RSS | ~35 | Yes |
| Checkout / premium overlay | ~30 | Yes |
| Admin inventory (`strings.admin`) | ~45 | No (inventory only) |

**Total:** ~275 string entries in the catalog; ~230 wired for the public app. Admin UI adds **hundreds** more when `admin/index.vue` is migrated (toasts, table headers, form labels, analytics KPIs).

Content from CMS/API (video titles, category names, homepage blocks, pill labels) is **not** in `strings.ts` — it is already dynamic and would be translated via the admin/content workflow or separate content locale fields.

## Overlap with PR #286

[PR #286](https://github.com/tojemoc/vmp/pull/286) (`cursor/2fa-copy-and-disable-50c1`) adds login mailto links, context-aware 2FA setup copy, and 2FA disable on the account page. This branch **includes the same string keys** under `login*` and `totp*` so you can merge either order:

- Merge #286 first, then this PR — resolve conflicts by keeping one `strings.ts` (keys should align).
- Merge this first, then #286 — #286 should reuse existing keys and only add disable-flow UI.

## Next implementation steps

1. **Admin pass** — Replace inline copy in `admin/index.vue` with `strings.admin.*` (or `adminStrings` module) in chunks by tab.
2. **API errors** — Many `data.error` strings come from the Worker in English; backend message catalogs would be a second project.
3. **Optional in-app locale switcher** — [`@nuxtjs/i18n`](https://i18n.nuxtjs.org/) if a single site needs multiple languages with `/sk/…` routes.
4. **Crowdin / Weblate** — Sync `locales/*/strings.ts` or exported JSON per locale file.

## Crowdin / Weblate effort

### Export format

Both tools accept **JSON** nested by key. A one-time export script can flatten `strings.ts`:

```json
{
  "signIn": "Sign in",
  "rateLimitMessage": "You've watched {current} of {limit} free previews…"
}
```

Functions become ICU or placeholder strings at export time.

### Effort estimate (technical, not calendar)

| Task | Scope |
|------|--------|
| Wire remaining admin UI | Large — one monolithic Vue file, many dynamic toasts with interpolated titles |
| Add 2nd locale file (e.g. Slovak) | Medium — duplicate ~230 keys; product already has `Klubové predplatné` as a plan name hint |
| Integrate Crowdin or Weblate | Small — GitHub/GitLab sync of `locales/*.json`; no code change to runtime beyond loading JSON |
| Locale switcher UX | Small — header dropdown + `localStorage` / cookie |
| SEO / `hreflang` | Optional — only if you use locale-prefixed routes |
| QA / linguistic review | Dominates human time — especially 2FA, PWA handoff, and billing copy |

**Crowdin** fits teams that want TMS features, in-context review, and GitHub PRs per locale.

**Weblate** fits open-source style workflows with direct repo commits; self-hostable.

Neither requires `@nuxtjs/i18n` initially — sync translated JSON into `locales/` and load from `useStrings()`.

### What translators should skip (v1)

- `strings.admin` until admin SFCs use the keys
- API-returned errors (unless you add `error.code` + client-side mapping)
- User-generated content (video titles, descriptions)
- Brand tokens: `VMP`, provider names (`Stripe`, `GoCardless`) often stay untranslated

## Verifying coverage

After changes, search for leftover viewer copy. No single regex catches everything.

**Long template text (letter-first, 9+ chars):**

```bash
rg -n ">[A-Za-z][^<{]{8,}<" packages/web/pages packages/web/components \
  --glob '*.vue' --glob '!admin/**'
```

**Shorter labels (5–8 chars) — catches `Close`, `Done`, `Step`, etc.:**

```bash
rg -n ">[A-Za-z][^<{]{4,7}<" packages/web/pages packages/web/components \
  --glob '*.vue' --glob '!admin/**'
```

**Non-letter starts** (numbers, punctuation, `&`, quotes):

```bash
rg -n ">[^<{][^<{]{4,}<" packages/web/pages packages/web/components \
  --glob '*.vue' --glob '!admin/**'
```

**Multi-line template text** (text split across lines inside tags):

```bash
rg -n -U ">\\s*\\n\\s*[A-Za-z]" packages/web/pages packages/web/components \
  --glob '*.vue' --glob '!admin/**'
```

On older `rg`, use `-P` instead of `-U` for multiline, or open the file when the line-based patterns look clean but UX still shows English literals.

Some matches will be icons, layout, or dynamic API fields — manual review is still needed.
