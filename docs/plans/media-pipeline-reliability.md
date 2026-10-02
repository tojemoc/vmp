# Media pipeline reliability + scale (`media-pipeline-reliability`)

## Goal

Make inbox → Encore → encore-packager → private object storage → API callback work **reliably on a single node**, with the same contracts used when scaling encode/packager workers horizontally.

## Why it failed in practice

1. Compose `${VMP_PACKAGER_SECRET}` / empty `AWS_*` → packager callbacks 401 or silent upload failure  
2. Supervisor `@vmp/storage` ignored `B2_BUCKET_NAME` / `S3_ENDPOINT_URL` while packager used different vars → split-brain buckets  
3. Hybrid host `ENCORE_BASE_URL=http://127.0.0.1:8080` + container packager → packager cannot fetch Encore job JSON  
4. In-memory packaging registry lost on supervisor restart → packaging timeouts  
5. `deploy.replicas` without Swarm → false confidence that packagers scaled  

## Deliverables

- [x] Storage env aliases (`B2_BUCKET_NAME`, `S3_ENDPOINT_URL`, `PACKAGE_OUTPUT_FOLDER` bucket)  
- [x] Startup **pipeline doctor** (fatal misconfig exits before accepting jobs)  
- [x] Redis-backed packaging job registry (survives supervisor restart)  
- [x] Packager-reachable Encore job URL rewrite (`PACKAGER_ENCORE_BASE_URL`)  
- [x] Compose fail-fast (`${VAR:?…}`), healthchecks, scale-friendly packager (no Swarm `deploy.replicas`)  
- [x] `npm run encore:doctor` / smoke script  
- [x] Docs + ROADMAP  

## Single-node happy path

```bash
cp packages/media-pipeline/encore/.env.example packages/media-pipeline/encore/.env
# fill secrets + B2 S3 endpoint/keys
npm run encore:up --workspace=@vmp/media-pipeline
npm run encore:doctor --workspace=@vmp/media-pipeline
# drop {uuid}.mp4 into inbox-fast-lane → expect master.m3u8 in B2 + preview_ready callback
```

## Scale path (same contracts)

```bash
npm run encore:up:scale --workspace=@vmp/media-pipeline
# ENCORE_WORKER_HIGH_REPLICAS / ENCORE_WORKER_LOW_REPLICAS / compose --scale encore-packager=N
```

No second storage or callback design for scale — only more workers consuming the same Redis queues.
