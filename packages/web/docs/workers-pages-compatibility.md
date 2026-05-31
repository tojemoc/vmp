# Pages vs Workers compatibility (audit only)

Non-fixing notes for the parallel Workers experiment. Primary production remains **Cloudflare Pages**.

## Pages-specific assumptions

| Area | Pages behavior | Workers experiment |
|------|----------------|-------------------|
| Deploy target | `wrangler pages deploy dist/` (`scripts/deploy-pages.mjs`, project `vmp-fe`) | `wrangler deploy` + `wrangler.toml`, Worker `vmp-web-worker-dev` |
| Nitro preset | `cloudflare_pages` → output under `dist/` with `_worker.js` | `cloudflare-module` → `.output/server/index.mjs` + `.output/public/` |
| Production prod web | `deploy.yml` uses `cloudflare/wrangler-action` Pages deploy to `CF_PAGES_PROJECT_NAME_PROD` | Not wired to tags yet; `[env.production]` name reserved |

## `_headers`

- **Pages:** `public/_headers` is applied by Pages for static assets and documented in-repo.
- **Workers:** Nitro copies/merges headers into `.output/public/_headers` for static assets. Unmatched SSR routes rely on Nitro-generated fallback rules, not the Pages CDN `_headers` file format for the Worker shell the same way.
- Custom rules for `/manifest.webmanifest`, `/sw.js`, `/workbox-*.js`, `/sw-push.js` in `public/_headers` should be validated on `*.workers.dev` after deploy.

## Asset paths

- Pages build: `dist/` with `publicDir` layout per `cloudflare_pages` preset.
- Workers build: `.output/public/` served via Wrangler `[assets]` binding `ASSETS`.
- Same Vite/Nuxt asset URLs (`/_nuxt/*`, `/icons/*`) expected; verify hashed assets and `manifest.webmanifest` on Workers URL.

## SSR / runtime

- Both presets use SSR (not `nuxi generate` static-only).
- Workers module preset uses `workerd` / `nodejs_compat` (see `wrangler.toml`); Pages uses the Pages Functions worker bundle format.
- **PWA:** Workbox + service worker registration may behave differently under Workers static asset routing vs Pages; test installability and `navigateFallback` on the experimental host.
- **No D1/KV bindings** on the web Worker today (stateless SSR + static assets only).

## CI isolation

- `deploy-web-workers.yml` does not run `npm run deploy` (Pages) or modify `deploy.yml`.
- Requires separate secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` (staging deploy uses `*_STAGING` suffixed secrets).
