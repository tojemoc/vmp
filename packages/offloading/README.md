# @vmp/offloading

Tiered storage offloading service for VMP:

- hot tier: Cloudflare R2
- cold tier: Garage (S3-compatible)
- migration jobs: demotion (R2 -> Garage), promotion (Garage -> R2)

## Contents

- [Responsibilities](#responsibilities)
- [Scripts](#scripts)
- [Environment](#environment)
- [Garage compose](#garage-compose)
- [Related documentation](#related-documentation)

## Responsibilities

1. Run Garage via Docker Compose
2. Select eligible videos for hot->cold demotion using traffic + age heuristics
3. Promote cold videos back to hot tier on sustained/burst traffic
4. Keep tier metadata and request counters in a local metadata store
5. Preserve stable object path semantics for edge routing

## Scripts

- `npm run build` - compile TypeScript to `dist/`
- `npm run offload` - age-based object offload (hot → cold) via `@vmp/storage`
- `npm run demote` - alias for `offload`
- `npm run demote-legacy` - previous video-level demotion using traffic metadata
- `npm run promote` - legacy promotion pass (Garage → R2)

Scheduling is **external** (cron/systemd on the VM) — this package exposes CLI modes only; there is no in-process scheduler.

## Environment

Copy `.env.example` and set values as needed.

Core settings:

- `OFFLOAD_R2_ROOT` / `OFFLOAD_GARAGE_ROOT`
- `OFFLOAD_KEY_PREFIX` / `OFFLOAD_LIST_PREFIX` (keep identical path structure)
- `OFFLOAD_MAX_HOT_AGE_SECONDS` (defaults to `OFFLOAD_RETENTION_DAYS` × 86400)
- `OFFLOAD_DELETE_FROM_HOT` (defaults to `OFFLOAD_DELETE_FROM_R2`, which defaults to `0`)
- `OFFLOAD_METADATA_FILE` (legacy demote/promote only)
- `OFFLOAD_RETENTION_DAYS`
- `OFFLOAD_DEMOTION_MAX_RPM_10M`
- `OFFLOAD_PROMOTION_BURST_RPM`
- `OFFLOAD_PROMOTION_10M`

## Garage compose

Use the package-local compose file:

```bash
cd packages/offloading
docker compose up -d
```

This provides:

- Garage API (3900)
- S3 endpoint (3901)
- data persistence via local volumes

Configure TLS termination in front of the S3 endpoint (reverse proxy/load balancer)
for production HTTPS exposure, including direct-fallback hostname (e.g.
`videos-direct.example.com`).

## Related documentation

| Document | Description |
| --- | --- |
| [Repository README](../../README.md) | Monorepo overview and documentation map |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker/Compose deployment recommendations for this package |
| [packages/media-pipeline/README.md](../media-pipeline/README.md) | Media VM pipeline that writes objects to R2 |
| [AGENTS.md](../../AGENTS.md) | R2 storage and video access architecture |
