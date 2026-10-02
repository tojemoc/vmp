# Horizontally scalable encoding (`horizontally-scalable-encoding`)

Shipped as part of the video-startup-latency PR (media pipeline ops). See also [video-startup-latency.md](./video-startup-latency.md).

## Problem

Default Compose runs FFmpeg on a single `encore-web` poller. Packager already had replica knobs; encode throughput did not scale across hosts/cores without a durable worker pool. SVT `encore-worker` exits after one job / drain, so naive `restart: unless-stopped` busy-loops when idle.

## Deliverables

- [x] `docker-compose.scale.yml` — disable web poller; looped `encore-worker-high` (queue 0) + `encore-worker-low` (queue 1)
- [x] GPU / NFS overlays for scaled workers (`scale.nvidia.yml`, `scale.vaapi.yml`, `scale.nfs.yml`)
- [x] `encore-worker-loop.sh` — sleep between worker exits (no restart storm)
- [x] Encore job priorities remapped so fast-lane 720p → queue 0 (`encorePriorities.ts`)
- [x] Optional `ENCORE_SEGMENT_LENGTH_SECONDS` for Encore segmented (intra-job) parallel encode
- [x] `npm run encore:up:scale` uses Compose `--scale` (Swarm `deploy.replicas` is a no-op for plain compose) — see also [media-pipeline-reliability.md](./media-pipeline-reliability.md)

## Ops quickstart

```bash
ENCORE_WORKER_HIGH_REPLICAS=3 ENCORE_WORKER_LOW_REPLICAS=2 ENCORE_PACKAGER_REPLICAS=3 \
  npm run encore:up:scale --workspace=@vmp/media-pipeline
```

Prerequisite: single-node stack must pass `npm run encore:doctor` with real B2/S3 credentials before scaling.
