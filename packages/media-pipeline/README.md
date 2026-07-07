# @vmp/media-pipeline

VMP media VM orchestration around **[SVT Encore](https://svt.github.io/encore/)** — production-grade transcoding-as-a-service used at Sveriges Television since 2019.

This package replaces the former `@vmp/podcast-host` custom ffmpeg/VAAPI encoder. Encore handles **video transcoding**; VMP still owns:

1. **Watchfolder intake** (`pipeline_watch.ts`) — inbox → stable file detection → video ID assignment
2. **Shaka Packager** — fMP4 HLS ladder (`master.m3u8`, per-rendition playlists, shared audio)
3. **rclone → Cloudflare R2** — same object layout as before (`videos/{id}/…`)
4. **Podcast MP3** — full `podcast.mp3` + preview jobs (`render_podcast_preview_mp3.ts`)
5. **Worker callbacks** — HMAC-signed `POST /api/admin/videos/:id/pipeline-status`
6. **Preview rebuild webhook** — supervisor accepts API-signed `podcast_preview_rebuild` events

## Architecture

Two ingest watchfolders let you A/B **fast-lane** (720p publishable first, then full ladder) vs **full-ladder-only** (single encode pass). Both paths log structured TTP with `pipelineMode` for comparison.

```text
┌─────────────────┐     POST /encoreJobs      ┌──────────────┐
│ pipeline_watch  │ ─────────────────────────►│ encore-web   │
│ (orchestrator)  │◄──── poll job status ─────│ + workers    │
└────────┬────────┘                           └──────┬───────┘
         │ enqueue packaging (Redis)                  │ FFmpeg (+ GPU profiles when available)
         ▼                                             ▼
┌─────────────────┐     S3 upload              shared /media volume
│ encore-packager │ ─────────────────────────► Cloudflare R2
│ (scale workers) │     (or inline Shaka+rclone when PACKAGING_MODE=inline)
└────────┬────────┘
         ▼
   @vmp/api Worker  ◄── pipeline-status callback (HMAC)
```

**Default (`PACKAGING_MODE=queue`):** Encore transcodes → supervisor enqueues [Eyevinn encore-packager](https://github.com/Eyevinn/encore-packager) → packager runs Shaka and uploads HLS to R2. Scale Encore workers and packager replicas independently (e.g. 3 encode + 3 package).

**Inline fallback (`PACKAGING_MODE=inline`):** orchestrator keeps Shaka Packager + rclone (legacy path for local dev without packager).

Encore does **not** package HLS — that matches [SVT’s design](https://svt.github.io/encore/).

## Contents

- [Quick start (VM)](#quick-start-vm)
- [Encore deployment](#encore-deployment)
- [Run supervisor (systemd)](#run-supervisor-systemd)
- [Environment](#environment)
- [R2 object layout (unchanged)](#r2-object-layout-unchanged)
- [Migration from podcast-host](#migration-from-podcast-host)
- [Related documentation](#related-documentation)

## Quick start (VM)

From a git checkout of this monorepo:

```bash
cd /path/to/vmp
npm install
npm run build --workspace=@vmp/media-pipeline
```

Start Encore (Redis + web + workers):

```bash
npm run encore:up --workspace=@vmp/media-pipeline
# or: docker compose -f packages/media-pipeline/encore/docker-compose.yml up -d
```

Configure `/etc/vmp/env` (see [Environment](#environment)), then install the systemd unit from [systemd/README.md](systemd/README.md).

## Encore deployment

Bundled Compose stack: [`encore/docker-compose.yml`](encore/docker-compose.yml)

| Service | Image | Role |
| --- | --- | --- |
| `redis` | `redis:8.6-alpine` | Job queue (Encore + packager) |
| `encore-web` | `ghcr.io/svt/encore-web:latest` | REST API (`POST /encoreJobs`, Swagger UI) |
| `encore-worker` | `ghcr.io/svt/encore-worker:latest` | Transcode workers (scale via `ENCORE_WORKER_REPLICAS`; mount `/dev/dri` for VAAPI) |
| `encore-packager` | `eyevinntechnology/encore-packager:latest` | Shaka HLS + R2 upload (scale via `ENCORE_PACKAGER_REPLICAS`) |

VMP-specific encoding profiles live in [`encore/profiles/`](encore/profiles/):

| Profile | Rendition | Notes |
| --- | --- | --- |
| `vmp-720p-audio` (+ GPU variants) | 720p + AAC | Fast-lane phase 1 |
| `vmp-full-ladder` (+ GPU VAAPI) | 1080p + 720p + 480p | Full ladder (single job) |
| `vmp-1080p` / `vmp-480p` | Per-rendition | Inline `PACKAGING_MODE=inline` only |
| `vmp-podcast-mp3` / `vmp-podcast-preview` | Audio sidecars | Queued path podcast MP3 |

**Shared storage:** mount the same host tree Encore and the orchestrator use. Default Compose bind-mounts `${ENCORE_MEDIA_MOUNT:-/mnt}` → `/media` inside containers. On the host, set:

```bash
MEDIA_HOST_ROOT=/mnt
ENCORE_MEDIA_ROOT=/media   # path as seen inside Encore containers
```

If Encore runs natively (JAR) on the same host without path translation, omit `ENCORE_MEDIA_ROOT` or set it equal to `MEDIA_HOST_ROOT`.

Official Encore docs: [Getting started](https://svt.github.io/encore/getting-started/) · [OpenAPI](https://svt.github.io/encore-doc/openapi.html)

## Run supervisor (systemd)

Point `WorkingDirectory` at the monorepo root. **`dist/` is gitignored** — run `npm run build --workspace=@vmp/media-pipeline` after every `git pull` that touches this package.

Production unit template: [systemd/vmp-supervisor.service](systemd/vmp-supervisor.service) — full install guide in [systemd/README.md](systemd/README.md).

Expose the supervisor HTTP port to the Worker only (VPN, SSH tunnel, or reverse proxy). Admin webhook URL:

`https://your-media-host/vmp/api/podcast-preview-rebuild`

When the supervisor listens on a public interface (`VMP_UI_HOST=0.0.0.0`), set `VMP_SUPERVISOR_DASHBOARD_SECRET` and enter it in the dashboard unlock form. Webhook paths remain authenticated via HMAC (`VMP_WEBHOOK_SECRET`); packaging callbacks use their own secrets.

## Environment

### Encore

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENCORE_BASE_URL` | `http://127.0.0.1:8080` | Encore web API base URL |
| `ENCORE_USER` / `ENCORE_PASSWORD` | — | HTTP basic auth when `ENCORE_SECURITY_ENABLED=true` |
| `ENCORE_MEDIA_ROOT` | `MEDIA_HOST_ROOT` | Path prefix Encore workers read (container mount) |
| `MEDIA_HOST_ROOT` | `/mnt` | Host path prefix for inbox/tmp |
| `ENCORE_POLL_MS` | `2000` | Job status poll interval |
| `ENCORE_JOB_TIMEOUT_MS` | `7200000` | Per-rendition transcode timeout (2 h) |
| `VMP_GPU_BACKEND` | `auto` | `auto` \| `vaapi` \| `nvenc` \| `cpu` — picks Encore profile variant |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | Passed to worker Compose for VAAPI profiles |

### Pipeline mode (dual inbox)

| Variable | Default | Purpose |
| --- | --- | --- |
| `INBOX_FAST_LANE_DIR` | `/mnt/videos/inbox-fast-lane` | **fast_lane** — 720p first, then full ladder (720p encoded twice) |
| `INBOX_FULL_LADDER_DIR` | `/mnt/videos/inbox-full-ladder` | **full_ladder** — single full ladder, `fully_processed` when done |
| `INBOX_DIR` | — | Legacy: if set, subdirs `fast-lane` / `full-ladder` are used when the above are unset |
| `PACKAGING_MODE` | `queue` | `queue` = encore-packager; `inline` = Shaka + rclone in orchestrator |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Packaging queue (supervisor + packager) |
| `VMP_SUPERVISOR_URL` | `http://127.0.0.1:8788` | Packaging enqueue/status API |
| `PACKAGER_CALLBACK_URL` | `http://host.docker.internal:8788/vmp/api` | encore-packager success/failure callbacks |

Drop a file in **fast-lane** inbox to stagger publish; drop in **full-ladder** for one-shot encoding. TTP logs include `pipelineMode` on every milestone for A/B analysis.

### VMP orchestrator

| Variable | Purpose |
| --- | --- |
| `VMP_WEBHOOK_SECRET` | Same as `podcast_rebuild_webhook_secret` in D1 |
| `VMP_SUPERVISOR_DASHBOARD_SECRET` | Protects dashboard + `/api/status` + job control (required when `VMP_UI_HOST` is not loopback) |
| `VMP_API_BASE_URL` | Worker base URL for pipeline status callbacks |
| `VMP_API_PIPELINE_SECRET` | Shared HMAC with Worker `VMP_API_PIPELINE_SECRET` |
| `VMP_UI_HOST` / `VMP_UI_PORT` | Supervisor dashboard + webhook bind (default `127.0.0.1:8788`) |
| `VMP_RUN_PIPELINE` | `1` run watchfolder; `0` UI + preview jobs only |
| `INBOX_FAST_LANE_DIR` / `INBOX_FULL_LADDER_DIR` | Dual watchfolders (see above) |
| `TMP_DIR_BASE` | Temp encode dirs (default `/mnt/tmp/video_pipeline`) |
| `RCLONE_REMOTE`, `R2_BUCKET_NAME`, … | rclone → R2 (see legacy table in git history) |
| `VMP_TTP_LOG_PATH` | Optional JSONL time-to-publish log |
| `DD_*` | Datadog DogStatsD tags (see [datadog/README.md](datadog/README.md)) |

**GPU:** `VMP_GPU_BACKEND=auto` probes NVENC then VAAPI at job start and selects `*-gpu-nvenc` / `*-gpu-vaapi` Encore profiles when registered. Mount GPU devices on `encore-worker` in Compose.

### Time-to-publish (TTP) logging

Unchanged — structured `VMP_TTP` lines on stdout. Summarize with:

```bash
node packages/media-pipeline/scripts/ttp-report.mjs /var/log/vmp-ttp.jsonl
```

## R2 object layout (unchanged)

Under `videos/{videoId}/`:

- `master.m3u8`, `720p/`, `1080p/`, `480p/`
- Shared audio: `init_audio.mp4`, `audio.m3u8`, `seg_audio_*.m4s`
- `podcast.mp3`, `podcast_preview.mp3`

The API video-proxy, RSS enclosures, and admin UI assume this layout — no Worker changes required for the Encore swap.

## Migration from podcast-host

See [MIGRATION.md](MIGRATION.md) for a step-by-step VM cutover checklist.

Summary:

1. Deploy Encore (`npm run encore:up`) and verify `curl http://127.0.0.1:8080/actuator/health`
2. Stop `vmp-supervisor`, pull this branch, `npm run build --workspace=@vmp/media-pipeline`
3. Update systemd `ExecStart` paths: `packages/media-pipeline/dist/supervisor.js`
4. Add Encore env vars; remove `VAAPI_DEVICE`
5. Start supervisor — pipeline health-checks Encore on boot

## Related documentation

| Document | Description |
| --- | --- |
| [MIGRATION.md](MIGRATION.md) | Cutover from `@vmp/podcast-host` |
| [systemd/README.md](systemd/README.md) | `vmp-supervisor` install |
| [datadog/README.md](datadog/README.md) | Agent templates |
| [AGENTS.md](../../AGENTS.md) | Monorepo secrets (`VMP_API_PIPELINE_SECRET`) |
| [SVT Encore docs](https://svt.github.io/encore/) | Upstream transcoder |
