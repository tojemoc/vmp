# Optional feature workspaces (`packages/features`)

See [deployment-feature-modules.md](../../docs/plans/deployment-feature-modules.md) and
[flagship-and-payment-middleware.md](../../docs/plans/flagship-and-payment-middleware.md).

## Purpose

Optional product surfaces live in:

| Location | Role |
|----------|------|
| `packages/web/features/<id>/` | Nuxt client plugins + UI fragments (always registered when present; Flagship gates runtime) |
| `packages/features/<id>/` | Future shared API + web modules (workspace packages) |

Today, **GTM**, **PWA**, and **PostHog** client plugins live under `packages/web/features/`.
The API gates routes via Flagship (`packages/api/src/infraFlags.ts` + `routeFeatureGuard.ts`).

## Runtime toggles (Flagship)

Infrastructure on/off is evaluated by Cloudflare Flagship (boolean flags, code default `false`).
Web hydrates `GET /api/deployment-features`. Local override: `FLAGSHIP_DEV_OVERRIDE` in
`packages/api/.dev.vars` only (never staging/prod).

## Future: `packages/features/*` workspaces

When a surface grows API + web + shared types, promote it:

```text
packages/features/newsletter/
  package.json          # @vmp/feature-newsletter
  src/api/              # route handlers imported by @vmp/api
  src/web/              # admin components
```

## Mosaiq / shared SaaS notes

- **Shared hosted** / **BYOD**: Flagship per environment defines the product SKU.
- **Rollout flags** (PostHog): UX experiments *within* an enabled module — never a substitute for Flagship.
