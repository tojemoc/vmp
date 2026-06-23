# VMP media host (systemd)

The `vmp-supervisor` unit runs the podcast-host supervisor: local dashboard, preview MP3 webhook, and the `pipeline_watch` child process.

## Contents

- [Install the unit file](#install-the-unit-file)
- [Build before first start](#build-before-first-start)
- [Environment file](#environment-file)
- [Enable and start](#enable-and-start)
- [Logs](#logs)
- [Drain and restart](#drain-and-restart)
- [Watchdog and stuck jobs](#watchdog-and-stuck-jobs)
- [Related documentation](#related-documentation)

## Install the unit file

```bash
sudo cp packages/podcast-host/systemd/vmp-supervisor.service /etc/systemd/system/
sudo systemctl daemon-reload
```

**Adjust paths** if the repo or Node binaries differ:

| Field | Purpose | How to set |
|-------|---------|------------|
| `VMP_ROOT` | Repository root (used in `ExecStart`) | Default `/root/vmp` in the unit; override in `/etc/vmp/env` |
| `NODE_BIN` | Node binary | Default `/usr/bin/node` in the unit; override in `/etc/vmp/env` |
| `NPM_BIN` | npm binary (deploy-time build only) | Default `/usr/bin/npm` in the unit; override in `/etc/vmp/env` |
| `ExecStart` | Absolute path to `dist/supervisor.js` | `${NODE_BIN}` + `${VMP_ROOT}/packages/podcast-host/dist/supervisor.js` |

`WorkingDirectory` is **not** set in the shipped unit: `ExecStart` uses an absolute script path, so changing `VMP_ROOT` in `/etc/vmp/env` is enough for a non-default install path.

If you add `WorkingDirectory` (optional, for tools that assume cwd = repo root), it is a **systemd unit directive only** — `/etc/vmp/env` cannot change it. When the repo is not at `/root/vmp`, either:

1. Edit `WorkingDirectory=` in `/etc/systemd/system/vmp-supervisor.service` (same path as `VMP_ROOT`), then `sudo systemctl daemon-reload`, or  
2. Create a drop-in, e.g. `/etc/systemd/system/vmp-supervisor.service.d/override.conf`:

```ini
[Service]
WorkingDirectory=/opt/vmp
```

Then `sudo systemctl daemon-reload` and restart.

Example overrides in `/etc/vmp/env` for `/opt/vmp` with system Node:

```ini
VMP_ROOT=/opt/vmp
NODE_BIN=/usr/bin/node
NPM_BIN=/usr/bin/npm
```

**NVM users:** the unit defaults to `/usr/bin/node`. Set `NODE_BIN` (and `NPM_BIN`) in `/etc/vmp/env` to your NVM binary, or create a stable symlink and point `NODE_BIN` at it:

```bash
sudo ln -sf "$HOME/.nvm/versions/node/$(nvm current)/bin/node" /usr/local/bin/vmp-node
sudo ln -sf "$HOME/.nvm/versions/node/$(nvm current)/bin/npm" /usr/local/bin/vmp-npm
```

```ini
NODE_BIN=/usr/local/bin/vmp-node
NPM_BIN=/usr/local/bin/vmp-npm
```

## Build before first start

`dist/` is not committed. Build once after deploy or pull:

```bash
cd "${VMP_ROOT:-/root/vmp}"
"${NPM_BIN:-npm}" run build --workspace=@vmp/podcast-host
```

The unit does **not** run `npm build` on every start (avoids latency and failures on restart).

## Environment file

Create `/etc/vmp/env` with the variables your deployment needs. Example:

```bash
sudo mkdir -p /etc/vmp
sudo tee /etc/vmp/env <<'EOF'
VMP_WEBHOOK_SECRET=your-hmac-secret
INBOX_DIR=/mnt/videos/inbox
TMP_DIR_BASE=/mnt/tmp/video_pipeline
RCLONE_REMOTE=r2
R2_BUCKET_NAME=your-bucket
VMP_API_BASE_URL=https://api.example.com
VMP_API_PIPELINE_SECRET=your-pipeline-secret
VMP_GPU_CONCURRENCY=1
VMP_UPLOAD_CONCURRENCY=2
VMP_UI_HOST=127.0.0.1
VMP_UI_PORT=8788
EOF
sudo chmod 600 /etc/vmp/env
```

See [packages/podcast-host/README.md](../README.md) and root [AGENTS.md](../../../AGENTS.md) for the full list of optional settings (Brevo, Stripe callbacks, preview MP3, etc.).

## Enable and start

```bash
sudo systemctl enable --now vmp-supervisor
sudo systemctl status vmp-supervisor
```

## Logs

```bash
journalctl -u vmp-supervisor -f
```

Optional file logging for Datadog file tailing: see `vmp-supervisor-logfile.conf.example` and [datadog/README.md](../datadog/README.md).

## Datadog (metrics, logs, process checks)

The transcoder emits DogStatsD metrics (`packages/podcast-host/metrics.ts`) and structured stdout lines (`VMP_TTP`, `VMP_PIPELINE_EVENT`). Agent install templates live in [packages/podcast-host/datadog/](../datadog/README.md).

Quick env vars in `/etc/vmp/env`:

```ini
DD_METRICS_ENABLED=1
DD_ENV=production
DD_SERVICE=vmp-transcoder
# Optional dedicated TTP JSONL for log tailing:
# VMP_TTP_LOG_PATH=/var/log/vmp/ttp.jsonl
```

## Drain and restart

**Drain / stop without starting a new instance** (maintenance, drain queue):

```bash
sudo systemctl stop vmp-supervisor
# or signal only:
sudo systemctl kill --signal=SIGTERM vmp-supervisor
```

Both send `SIGTERM` (`KillSignal=SIGTERM`) so the supervisor can shut down preview children and `pipeline_watch`. `Restart=on-failure` only applies after a **non-zero exit**; a clean stop does not auto-restart.

**Restart after config or code changes** (graceful stop, then start a new process):

```bash
sudo systemctl restart vmp-supervisor
```

Use restart when applying `/etc/vmp/env` or a new `dist/` build; use stop when you want the host idle.

## Watchdog and stuck jobs

The unit uses `Type=notify` with `WatchdogSec=60`. The supervisor sends `READY=1` when the HTTP server is listening and `WATCHDOG=1` every 20 seconds while the `pipeline_watch` child is alive and **no** job has been stuck in `running` longer than `VMP_STUCK_JOB_MINUTES` (default 60).

Notifications use `/usr/bin/systemd-notify` (from the `systemd` package). Node’s `node:dgram` module does not support Unix datagram sockets (`AF_UNIX` / `SOCK_DGRAM`), which `sd_notify(3)` requires.

If a job exceeds that threshold, the supervisor **stops** sending `WATCHDOG=1`. Systemd then waits `WatchdogSec=60` before marking the unit failed. With `Restart=on-failure` and `RestartSec=5`, systemd starts a new process after the restart delay, so the typical gap before a fresh supervisor is **about `WatchdogSec` + `RestartSec` (~65 seconds)**, not 60 seconds alone. That recovery path is intentional for stuck encode/upload work.

## Related documentation

| Document | Description |
| --- | --- |
| [Repository README](../../../README.md) | Monorepo overview and documentation map |
| [packages/podcast-host/README.md](../README.md) | Pipeline, supervisor, webhooks, TTP logging, env reference |
| [AGENTS.md](../../../AGENTS.md) | Worker secrets and pipeline callback endpoints |
