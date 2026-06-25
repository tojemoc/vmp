# Web: Cloudflare Workers (current) vs Pages (deprecated)

| | Pages (deprecated) | Workers (canonical) |
|---|---|---|
| Config | `wrangler.toml` | `wrangler.workers.toml` |
| Deploy | ~~`wrangler pages deploy`~~ | `wrangler deploy` |
| Nitro preset | `cloudflare_pages` → `dist/` | `cloudflare-module` → `.output/` |
| Staging Worker | — | `vmp-web-worker-dev` |
| Production Worker | — | `vmp-web-worker-prod` |
| CI | removed | `.github/workflows/deploy.yml` |

## Custom domains

Attach hostnames to the **Worker** that matches the environment (`vmp-web-worker-dev` for staging traffic from `main`, `vmp-web-worker-prod` for tagged releases). Do not rely on the old `vmp-fe` Pages project.

## PWA / headers

Custom rules for `/manifest.webmanifest`, `/sw.js`, `/workbox-*.js`, `/sw-push.js` in `public/_headers` apply to Worker static assets under `[assets]`.

## Related docs

- [workers-deploy-env.md](./workers-deploy-env.md) — build-time env vars for CI
- [DEPLOYMENT.md](../../DEPLOYMENT.md) — full CD flow
- [AGENTS.md](../../AGENTS.md) — “When deploy looks broken but CI is green”
