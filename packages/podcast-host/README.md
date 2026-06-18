# @vmp/podcast-host

Runs on the **media VM** (alongside ffmpeg, shaka-packager, rclone). It bundles:

1. **`pipeline_watch.ts`** — watchfolder → encode → Shaka HLS → `podcast.mp3` → R2 (compiled to `dist/pipeline_watch.js`).
2. **`supervisor.ts`** — one long-lived Node process that:
   - spawns the pipeline as a child (optional via `VMP_RUN_PIPELINE`),
   - serves a **local dashboard** at `http://127.0.0.1:8788/` (job queue + pipeline status + log tail),
   - accepts the **same signed webhook** the Worker sends (`POST /api/podcast-preview-rebuild`, HMAC body).
3. **`render_podcast_preview_mp3.ts`** — builds `podcast_preview.mp3` from full `podcast.mp3` for a given duration (compiled to `dist/render_podcast_preview_mp3.js`).

## Contents

- [Install on the VM](#install-on-the-vm)
- [Run (recommended: systemd)](#run-recommended-systemd)
  - [Environment](#environment)
  - [Time-to-publish (TTP) logging](#time-to-publish-ttp-logging)
  - [Encode progress (dashboard)](#encode-progress-dashboard)
  - [rclone + Cloudflare R2](#rclone--cloudflare-r2)
  - [Migration note (legacy `.sh` overrides)](#migration-note-legacy-sh-overrides)
- [“Fragmented MP3” and podcast apps](#fragmented-mp3-and-podcast-apps)
- [npm scripts](#npm-scripts)
- [Video ID migration workflow (no reupload)](#video-id-migration-workflow-no-reupload)
- [Related documentation](#related-documentation)

## Install on the VM

From a git checkout of this monorepo:

```bash
cd /path/to/vmp
npm install
```

## Run (recommended: systemd)

Point `WorkingDirectory` at the monorepo root. **`dist/` is gitignored** — run `npm run build --workspace=@vmp/podcast-host` after every `git pull` that touches `packages/podcast-host/` (auto-upgrade does this when `VMP_AUTO_UPGRADE=1`).

**Do not** point `ExecStart` or `VMP_*_SCRIPT` at `.ts` source files. Even on Node 24 (native type stripping), compiled imports such as `./ttpLog.js` resolve only under `dist/`.

For production installs, prefer the maintained unit in [systemd/README.md](systemd/README.md).

Example unit (adjust paths and secrets):

```ini
[Unit]
Description=Video Pipeline Watcher Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/vmp
Environment=VMP_WEBHOOK_SECRET=your-secret
Environment=INBOX_DIR=/mnt/videos/inbox
Environment=TMP_DIR_BASE=/mnt/tmp/video_pipeline
Environment=R2_BUCKET_NAME=vmp-videos
Environment=RCLONE_REMOTE=vmp-videos
Environment=VMP_UI_HOST=0.0.0.0
# Omit VMP_PIPELINE_SCRIPT / VMP_RENDER_SCRIPT to use dist/*.js defaults next to supervisor.js
ExecStartPre=/usr/bin/npm run build --workspace=@vmp/podcast-host
ExecStart=/root/.nvm/versions/node/v24.14.1/bin/node /root/vmp/packages/podcast-host/dist/supervisor.js
Restart=always
User=root
Group=root
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Minimal fix if you already built manually — only change the three paths from `.ts` to `dist/*.js` and drop the script overrides:

```ini
ExecStart=/root/.nvm/versions/node/v24.14.1/bin/node /root/vmp/packages/podcast-host/dist/supervisor.js
# Remove these lines (defaults are correct when ExecStart uses dist/supervisor.js):
# Environment=VMP_PIPELINE_SCRIPT=...
# Environment=VMP_RENDER_SCRIPT=...
```

Expose the HTTP port to the Worker only (VPN, SSH tunnel, or reverse proxy with auth). In the admin UI, set the webhook URL to:

`https://your-media-host/vmp/api/podcast-preview-rebuild`

(supervisor also accepts `/api/podcast-preview-rebuild` and legacy `/vmp/podcast-preview-rebuild`).

### Environment

| Variable | Purpose |
|----------|---------|
| `VMP_WEBHOOK_SECRET` | Same value as `podcast_rebuild_webhook_secret` in D1 admin settings |
| `VMP_API_BASE_URL` | VMP Worker base URL (e.g. `https://api.example.workers.dev`) for pipeline status callbacks |
| `VMP_API_PIPELINE_SECRET` | Shared HMAC secret with Worker `VMP_API_PIPELINE_SECRET` (pipeline → `POST /api/admin/videos/:id/pipeline-status`) |
| `VMP_UI_HOST` | Bind address (default `127.0.0.1`) |
| `VMP_UI_PORT` | Dashboard + webhook port (default `8788`) |
| `VMP_RUN_PIPELINE` | `1` (default) run watchfolder pipeline; `0` only UI + preview jobs |
| `VMP_PIPELINE_SCRIPT` | Override path to `pipeline_watch.js` |
| `VMP_RENDER_SCRIPT` | Override path to `render_podcast_preview_mp3.js` |
| `VMP_PREVIEW_CONCURRENCY` | Parallel preview encodes (default `1`) |
| `MP3_BITRATE` | Full and preview podcast MP3 bitrate in kbps (default `128`) |
| `VIDEO_ID_STRATEGY` | Video ID assignment mode: `random` (default, renames uploads to UUID IDs) or `filename` (legacy, derive from filename) |
| `VIDEO_ID_SANITIZE_MODE` | Controls ID derivation from filename stem: `slug-hash` (default), `slug`, `base64url`, `none` |
| `VAAPI_DEVICE` | GPU device node for VAAPI hardware encoding (default `/dev/dri/renderD128`). Requires a GPU with VAAPI support and read/write access to the device node. |
| `INBOX_DIR`, `TMP_DIR_BASE`, `R2_BUCKET`, … | Passed through to the Node entrypoint/processing pipeline |
| `RCLONE_REMOTE` | rclone remote name (e.g. `vmp-videos`). If the remote already includes the bucket in `~/.config/rclone/rclone.conf`, **omit** `R2_BUCKET_NAME` — otherwise paths become `remote:bucket:bucket/...` |
| `R2_BUCKET_NAME` | Bucket segment when using `RCLONE_REMOTE:bucket` path form |
| `RCLONE_TRANSFERS` | Parallel file uploads (default `4`; lower if R2 returns 501) |
| `RCLONE_UPLOAD_CONCURRENCY` | S3 multipart concurrency (default `2` for R2 stability) |
| `RCLONE_EXTRA_ARGS` | Extra rclone flags (space-separated) |
| `RCLONE_LOG_LEVEL` | rclone log level (default `NOTICE`; use `ERROR` to hide retry noise) |
| `VMP_TTP_LOG_PATH` | Optional path to append structured `VMP_TTP` JSON lines (one object per line) for TTP analysis |

### Time-to-publish (TTP) logging

The pipeline emits machine-readable milestones on stdout (and optionally `VMP_TTP_LOG_PATH`):

```text
VMP_TTP	{"type":"ttp_milestone","videoId":"…","milestone":"inbox_close_write","at":"2026-…",…}
VMP_TTP	{"type":"ttp_summary","videoId":"…","minimalPublishReadyElapsedMs":…,"fullRenditionsReadyElapsedMs":…,…}
```

Key milestones:

| Milestone | Meaning |
|-----------|---------|
| `inbox_close_write` | inotify `close_write` on inbox (SMB upload finished) |
| `minimal_publish_ready` | 720p HLS + master manifest on R2 (minimal publish / preview) |
| `full_renditions_ready` | 1080p + 720p + 480p on R2 |
| `ttp_summary` | One row per job with elapsed ms and ratios vs source duration |

Summarize a log file:

```bash
grep '^VMP_TTP' /var/log/vmp-pipeline.log | node packages/podcast-host/scripts/ttp-report.mjs
# or
node packages/podcast-host/scripts/ttp-report.mjs /var/log/vmp-ttp.jsonl
```

Ratios in `ttp_summary` are wall-clock seconds divided by source duration (e.g. `0.35` ≈ 35% of video length to reach minimal publish).

### Encode progress (dashboard)

During ffmpeg encodes the pipeline emits `VMP_PIPELINE_PROGRESS` JSON lines (parsed by the supervisor, shown as progress bars on `:8788`). Progress uses ffmpeg `time=` vs probed source duration for each rendition, combined into an overall 0–100% estimate across pipeline stages.

### rclone + Cloudflare R2

Configure the remote with `provider = Cloudflare` in `rclone.conf` (see [Cloudflare R2 rclone docs](https://developers.cloudflare.com/r2/examples/rclone/)).

Transient `501 Not Implemented` lines during upload usually mean rclone retried with a different strategy — look for `Attempt 2/3 succeeded`. The pipeline now:

- uploads shared audio segments (`seg_audio_*.m4s`) in **one** batched `rclone copy` instead of hundreds of per-file calls
- passes R2-friendly defaults: `--s3-no-check-bucket`, `--s3-upload-concurrency=2`, `--transfers=4`

If 501s persist, try `Environment=RCLONE_TRANSFERS=2` and `Environment=RCLONE_UPLOAD_CONCURRENCY=1` in systemd. If your rclone remote already embeds the bucket name, remove `R2_BUCKET_NAME` from the unit file.

### Migration note (legacy `.sh` overrides)

If your deployment previously set `VMP_PIPELINE_SCRIPT` or `VMP_RENDER_SCRIPT` to legacy `.sh` files, update them to the compiled `.js` paths in `dist/`. The shell scripts were removed.

- `VMP_PIPELINE_SCRIPT` → `packages/podcast-host/dist/pipeline_watch.js`
- `VMP_RENDER_SCRIPT` → `packages/podcast-host/dist/render_podcast_preview_mp3.js`

## “Fragmented MP3” and podcast apps

**HLS** (and DASH) use **segmented** media — that is what people often mean by “fragmented” streaming. **Podcast RSS enclosures** almost always expect a **single URL** to one file (MP3/M4A) or, in our app, an HLS URL — not a bag of raw MPEG TS fragments.

**MP3** can be streamed in theory, but there is **no** widely supported standard for “fragmented MP3” as a podcast enclosure the way HLS is for video. **Do not** rely on exotic MP3 framing for RSS: keep using **one `podcast_preview.mp3` file** (re-encoded when preview length changes) or **HLS** for preview, which podcast apps already handle via the proxy URL.

## npm scripts

- `npm run start` — supervisor (pipeline + dashboard + webhook)
- `npm run pipeline` — pipeline runner (Node orchestrator + subprocess tools)
- `npm run render -- <video_id> <seconds>` — one-off preview MP3
- `npm run migrate:r2-video-prefixes` — copy/sync `videos/<old_id>/` prefixes to `videos/<new_id>/` using mapping JSON from API migration

## Video ID migration workflow (no reupload)

1. Generate mapping on API side (dry run):

```bash
cd /path/to/vmp
DRY_RUN=1 APPLY=0 MAPPING_JSON_PATH=/tmp/video-id-map.json \
  npm run db:migration-normalize-video-ids --workspace=@vmp/api
```

2. Apply DB rewrite when mapping looks correct:

```bash
DRY_RUN=0 APPLY=1 MAPPING_JSON_PATH=/tmp/video-id-map.json \
  npm run db:migration-normalize-video-ids --workspace=@vmp/api
```

3. On the podcast-host VM, pull this branch and run R2 prefix migration:

```bash
cd /path/to/vmp
MAPPING_JSON_PATH=/tmp/video-id-map.json \
  R2_BUCKET=vmp-videos \
  bash ./packages/podcast-host/bin/video_id_r2_prefix_migrate.sh
```

Optional flags:
- `APPLY=0` (default) preview only
- `APPLY=1` perform copy/sync
- `DELETE_OLD=1` delete old prefixes after successful copy + verification

## Related documentation

| Document | Description |
| --- | --- |
| [Repository README](../../README.md) | Monorepo overview and documentation map |
| [systemd/README.md](systemd/README.md) | `vmp-supervisor` systemd unit install, env file, logs, watchdog |
| [AGENTS.md](../../AGENTS.md) | Worker API, pipeline callbacks, secrets (`VMP_API_PIPELINE_SECRET`) |
| [packages/offloading/README.md](../offloading/README.md) | R2 hot/cold tier offloading to Garage |
| [packages/moq-probe/README.md](../moq-probe/README.md) | MoQ probe (future live ingest path) |
