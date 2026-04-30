# @vmp/offloading

Tiered storage offloading service for VMP:

- hot tier: Cloudflare R2
- cold tier: Garage (S3-compatible)
- migration jobs: demotion (R2 -> Garage), promotion (Garage -> R2)

## Responsibilities

1. Run Garage via Docker Compose
2. Select eligible videos for hot->cold demotion using traffic + age heuristics
3. Promote cold videos back to hot tier on sustained/burst traffic
4. Keep tier metadata and request counters in a local metadata store
5. Preserve stable object path semantics for edge routing

## Scripts

- `npm run build` - compile TypeScript to `dist/`
- `npm run demote` - run one demotion pass
- `npm run promote` - run one promotion pass

## Environment

Copy `.env.example` and set values as needed.

Core settings:

- `OFFLOAD_R2_ROOT` / `OFFLOAD_GARAGE_ROOT`
- `OFFLOAD_KEY_PREFIX` (keep identical path structure)
- `OFFLOAD_METADATA_FILE` (JSON metadata state)
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
