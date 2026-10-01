# Private B2-only object storage (`b2-private-bucket-only`)

## Product decision

Production origin storage is **one private Backblaze B2 bucket**. Every browser/app byte exits via **Cloudflare** (API Worker) so Bandwidth Alliance egress applies and the bucket is never a public CDN.

Do **not**:

- Keep R2 as a live failover / dual-write “feature flag”
- Split thumbs on R2 vs video on B2

Local Wrangler may still use the R2 binding as the **single** `ObjectStorageProvider` when B2 credentials are unset (dev convenience only).

## Architecture

```text
Client → Cloudflare Worker (@vmp/api)
           ├─ /api/video-proxy/*   (signed vt — HLS / podcast)
           └─ /api/assets/*        (public allowlisted prefixes)
                    ↓
              Private B2 (S3 API)
```

Encore / encore-packager and `@vmp/media-pipeline` write with `STORAGE_PROVIDER=b2` (same key layout: `videos/`, `thumbnails/`, …).

## Deliverables

- [x] B2-only `createPlaybackStorage` (no `PrimaryWithFailoverCache` in the hot path)
- [x] `/api/assets/*` proxy for `thumbnails/`, `cms/`, `pills/`
- [x] Media entrypoint + duration resolution via `ObjectStorageProvider` (no public `R2_BASE_URL` HEAD/GET)
- [x] Thumbnail / CMS / pills URLs built from API origin + `/api/assets/…`; legacy `R2_BASE_URL` URLs rewritten on read
- [x] Offline download path storage-only (no HTTP origin fallback)
- [x] Docs: `AGENTS.md`, `DEPLOYMENT.md`, `@vmp/storage`, media-pipeline env examples

## Ops (maintainer)

1. Create private B2 bucket; application key with read/write.
2. Set Worker secrets: `B2_BUCKET_NAME`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY`, optional `B2_S3_ENDPOINT` / `B2_REGION`.
3. Sync objects from R2 → B2 (same keys).
4. Point media VM / packager at B2 (`STORAGE_PROVIDER=b2`, packager `S3_ENDPOINT_URL`).
5. Smoke: play via `/api/video-proxy`, homepage thumbs via `/api/assets/…`, confirm bare B2 URL is denied.
6. Detach public R2 custom domain (`vmp-videos.tjm.sk`) when traffic is verified.

## Related

- Roadmap: `b2-private-bucket-only`
- Prior storage adapters: #449, #450
- Investigation issue: [#435](https://github.com/tojemoc/vmp/issues/435) / TOJ-9
