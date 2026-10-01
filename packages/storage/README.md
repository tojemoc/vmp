# @vmp/storage

Pluggable object storage for VMP (`packages/api`, `packages/api-node`, `packages/media-pipeline`).

## Interface

All packages depend on `ObjectStorageProvider` — not a concrete R2/S3 client.

```ts
import type { ObjectStorageProvider } from '@vmp/storage'
```

## Providers

| ID | Implementation | When to use |
|---|---|---|
| `r2` | `S3CompatibleStorageProvider` (S3 API against R2 endpoint) | Local/dev or one-off ops |
| `b2` | Same class, B2 endpoint defaults | **Production origin** (private bucket) |
| `s3-compatible` | Same class, fully custom endpoint | Any other S3 API |

**Production:** set Worker secrets `B2_BUCKET_NAME` / `B2_ACCESS_KEY_ID` / `B2_SECRET_ACCESS_KEY` (optional `B2_S3_ENDPOINT`, `B2_REGION`). The API Worker serves all public reads through `/api/video-proxy` (signed) and `/api/assets` (allowlisted). Do not dual-write to R2.

**Local Wrangler:** when B2 secrets are unset, `@vmp/api` uses the native R2 binding via `wrapR2Bucket()` (`@vmp/storage/worker`) as the single provider.

Node services (`api-node`, `media-pipeline`) use `createStorageProviderFromEnv()` (`@vmp/storage/node`) with `STORAGE_PROVIDER=b2` in production.

## Environment variables

| Variable | Purpose |
|---|---|
| `STORAGE_PROVIDER` | `r2` (default), `b2`, or `s3-compatible` |
| `S3_BUCKET_NAME` / `R2_BUCKET_NAME` | Bucket name |
| `S3_ENDPOINT` / `R2_ENDPOINT` | S3 API endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Credentials (Node / presigned URLs) |
| `B2_ACCESS_KEY_ID` / `B2_SECRET_ACCESS_KEY` | Backblaze B2 credentials |
| `S3_FORCE_PATH_STYLE` | Set `1` for path-style URLs (common on B2) |

Existing R2 deployments only need their current bucket binding (Workers) or `S3_BUCKET_NAME` + endpoint (api-node).

## Adding a new S3-compatible provider

**Config only** — no new code:

```ts
createStorageProvider({
  type: 's3-compatible',
  id: 'wasabi',
  bucket: 'my-bucket',
  endpoint: 'https://s3.wasabisys.com',
  region: 'us-east-1',
  accessKeyId: '...',
  secretAccessKey: '...',
  forcePathStyle: true,
})
```

Or set `STORAGE_PROVIDER=s3-compatible` and the standard `S3_*` / `AWS_*` env vars.

## Adding a genuinely different provider

Implement `ObjectStorageProvider` in a new class (e.g. local filesystem for tests, or a composite hot/cold tier) and register it in your composition root. The interface is intentionally provider-agnostic so a future read-through cache can wrap multiple `ObjectStorageProvider` instances without changing call sites.

## Subpath exports

- `@vmp/storage/worker` — R2 binding adapter (Cloudflare Workers)
- `@vmp/storage/node` — S3 factory, upload helpers, R2Bucket bridge for api-node

Package `exports` resolve to compiled `dist/*.js` at runtime (TypeScript sources remain the `types` entry). Run `npm run build --workspace=@vmp/storage` before plain `node` consumers (`media-pipeline`, `offloading`) or Wrangler; Node's built-in type stripping does not remap `./foo.js` imports to `./foo.ts`.
