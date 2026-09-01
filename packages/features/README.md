# Optional feature workspaces (`packages/features`)

Phase 4 of [deployment-feature-modules](../../docs/plans/deployment-feature-modules.md).

## Purpose

Dedicated Cloudflare Worker builds (Mosaiq channel Workers, BYOD slim tenants) may omit entire product surfaces. Optional code lives in:

| Location | Role |
|----------|------|
| `packages/web/features/<id>/` | Nuxt client plugins + UI fragments registered only when `id` ∈ `VMP_FEATURES` |
| `packages/features/<id>/` | Future shared API + web modules (workspace packages) |

Today, **GTM**, **PWA**, and **PostHog** client plugins live under `packages/web/features/`. The API gates routes via `packages/api/src/routeFeatureGuard.ts`.

## Slim build workflow (manual today)

1. Set `VMP_FEATURES` to the allowlist for the target profile (see plan doc).
2. Remove optional folders not in the allowlist (or keep them — they are not registered when omitted from `VMP_FEATURES`).
3. Build web: `VMP_FEATURES=… npm run build --workspace=@vmp/web`
4. Deploy API with the same `VMP_FEATURES` Worker var.

### Example: staging without GTM

```bash
export VMP_FEATURES=posthog,pwa,push,payments,cms,analytics,newsletter,einvoicing,legacy_migration,rss_podcast,rss_podcast_preview_mp3,pills,deno_replication
```

## Future: `packages/features/*` workspaces

When a surface grows API + web + shared types, promote it:

```text
packages/features/newsletter/
  package.json          # @vmp/feature-newsletter
  src/api/              # route handlers imported by @vmp/api
  src/web/              # admin components
```

The root `package.json` workspaces entry and conditional `import()` in `@vmp/api` / `@vmp/web` keep slim builds from bundling unused features.

## Mosaiq / shared SaaS notes

- **Shared hosted** (subdomain/slug): one Worker, tenant D1 binding per channel; `VMP_FEATURES` defines the product SKU.
- **BYOD SaaS**: same codebase, customer domain + D1; compile-time allowlist per tier (e.g. no `legacy_migration`, no `einvoicing`).
- **Rollout flags** (PostHog / Cloudflare): UX experiments *within* a compiled module — never a substitute for `VMP_FEATURES`.
