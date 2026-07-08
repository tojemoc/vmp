# Migration: `@vmp/podcast-host` → `@vmp/media-pipeline` + SVT Encore

This guide covers moving a production media VM from the legacy in-repo ffmpeg/VAAPI transcoder to **SVT Encore** with the VMP orchestrator in `packages/media-pipeline`.

## What changed

| Area | Before (`podcast-host`) | After (`media-pipeline`) |
| --- | --- | --- |
| Package name | `@vmp/podcast-host` | `@vmp/media-pipeline` |
| Transcoding | Inline ffmpeg + VAAPI in `pipeline_watch.ts` | Encore REST API + worker pool |
| New services | — | Redis, `encore-web`, `encore-worker`, `encore-packager` (Compose) |
| HLS packaging | Shaka Packager in orchestrator | **encore-packager** |
| Ingest | Single `INBOX_DIR` | Dual inbox: `INBOX_FAST_LANE_DIR` + `INBOX_FULL_LADDER_DIR` |
| GPU | `VAAPI_DEVICE` on host ffmpeg | Encore GPU profiles (`VMP_GPU_BACKEND=auto`, worker `/dev/dri`) |
| R2 upload | rclone | packager → S3 |
| Worker webhooks | pipeline-status + preview rebuild | **Unchanged** (same HMAC contracts) |
| R2 key layout | `videos/{id}/…` | **Unchanged** |

## Prerequisites

- Docker (for bundled Encore stack) **or** a self-managed Encore install per [SVT docs](https://svt.github.io/encore/getting-started/)
- Redis 8+ (standard Redis server; included in Compose)
- Shared filesystem: inbox, temp dirs, and Encore `outputFolder` must be visible to Encore workers
- Existing: ffmpeg/ffprobe (probe + podcast MP3), inotifywait

## Cutover steps

### 1. Drain in-flight jobs

```bash
# Docker (recommended)
cd packages/media-pipeline/encore
docker compose stop vmp-supervisor

# Or systemd
sudo systemctl stop vmp-supervisor
# Wait until no active encodes (check dashboard http://127.0.0.1:8788/ or logs)
```

### 2. Pull code and rebuild

```bash
cd /path/to/vmp
git pull
npm install
npm run build --workspace=@vmp/media-pipeline
```

### 3. Start Encore + supervisor (Docker)

```bash
cd packages/media-pipeline/encore
cp .env.example .env   # fill secrets (or symlink /etc/vmp/env and set VMP_ENV_FILE)
docker compose up -d
curl -sf http://127.0.0.1:8080/actuator/health
curl -sf http://127.0.0.1:8788/health
```

Tune worker count:

```bash
ENCORE_WORKER_REPLICAS=4 docker compose -f encore/docker-compose.yml up -d --scale encore-worker=4
```

### 4. Update `/etc/vmp/env`

Add:

```bash
ENCORE_BASE_URL=http://encore-web:8080
MEDIA_HOST_ROOT=/media
ENCORE_MEDIA_ROOT=/media
INBOX_FAST_LANE_DIR=/media/videos/inbox-fast-lane
INBOX_FULL_LADDER_DIR=/media/videos/inbox-full-ladder
TMP_DIR_BASE=/media/tmp/video_pipeline
REDIS_URL=redis://redis:6379
VMP_GPU_BACKEND=auto
PACKAGER_CALLBACK_URL=http://vmp-supervisor:8788/vmp/api
PACKAGE_OUTPUT_FOLDER=s3://YOUR_BUCKET/videos
S3_ENDPOINT_URL=https://YOUR_ACCOUNT.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Optional GPU on workers:

```bash
VAAPI_DEVICE=/dev/dri/renderD128
```

Keep all existing `VMP_*`, `INBOX_DIR`, and `VMP_API_*` variables.

If the supervisor listens on a public interface (e.g. `VMP_UI_HOST=0.0.0.0` for Worker webhooks), add:

```bash
VMP_SUPERVISOR_DASHBOARD_SECRET=<long-random-string>
```

Webhooks stay on HMAC (`VMP_WEBHOOK_SECRET`); the dashboard unlock form and job-control APIs require this separate secret.

### 5. Systemd unit (optional)

If you run the supervisor on the host instead of Docker, update `/etc/systemd/system/vmp-supervisor.service` paths and set `NODE_BIN` when using NVM:

```ini
NODE_BIN=/root/.nvm/versions/node/v24.14.1/bin/node
```

Copy the maintained template from `packages/media-pipeline/systemd/vmp-supervisor.service` if unsure.

### 6. Update Datadog process checks (optional)

Process search strings now reference `packages/media-pipeline/dist/`. Re-copy templates from `packages/media-pipeline/datadog/conf.d/process.d/conf.yaml`.

### 7. Start supervisor

**Docker (recommended):**

```bash
cd packages/media-pipeline/encore
docker compose up -d vmp-supervisor
docker compose logs -f vmp-supervisor
```

**Systemd:**

```bash
sudo systemctl daemon-reload
sudo systemctl start vmp-supervisor
sudo journalctl -u vmp-supervisor -f
```

Expect boot log: `Encore API: http://127.0.0.1:8080`. Drop a test MP4 in `INBOX_FAST_LANE_DIR` and confirm phase-1 `preview_ready` callback.

### 8. Admin UI

No changes — podcast rebuild webhook URL and D1 secrets are unchanged.

## Rollback

1. `sudo systemctl stop vmp-supervisor`
2. `git checkout <previous-release>` (package still at `packages/podcast-host` on old branches)
3. `npm run build --workspace=@vmp/podcast-host`
4. Restore systemd `ExecStart` paths and `VAAPI_DEVICE`
5. `docker compose -f packages/media-pipeline/encore/docker-compose.yml down` (optional)
6. `sudo systemctl start vmp-supervisor`

## FAQ

**Do I need to re-encode existing R2 assets?** No. Only new inbox uploads use Encore.

**Can I run Encore without Docker?** Yes — run the Encore JAR on the host and point `ENCORE_BASE_URL` at it. Copy `encore/profiles/` to the profile path Encore expects.

**Does the API Worker need redeploying?** No — callback payloads and R2 layout are unchanged. Update `AGENTS.md` references only.

**CI changes?** Merges to `main` publish `ghcr.io/tojemoc/vmp-media-pipeline` via `.github/workflows/media-pipeline-docker.yml`. Pull `:latest` or a commit SHA tag on the media VM; no host `npm build` required when using Compose.
