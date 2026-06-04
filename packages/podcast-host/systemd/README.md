# VMP media host (systemd)

The `vmp-supervisor` unit runs the podcast-host supervisor: local dashboard, preview MP3 webhook, and the `pipeline_watch` child process.

## Install the unit file

```bash
sudo cp packages/podcast-host/systemd/vmp-supervisor.service /etc/systemd/system/
sudo systemctl daemon-reload
```

**Adjust paths** in the unit file (or in `/etc/vmp/env`) if the repo or Node binaries differ:

| Field | Purpose | How to set |
|-------|---------|------------|
| `VMP_ROOT` | Repository root | e.g. `/root/vmp` or `/opt/vmp` |
| `NODE_BIN` | Node binary | `which node` (system) or `~/.nvm/versions/node/$(nvm current)/bin/node` |
| `NPM_BIN` | npm binary | `which npm` (system) or matching NVM `bin/npm` |
| `WorkingDirectory` | Must match `VMP_ROOT` if you change it | Same as `VMP_ROOT` in the shipped unit |
| `ExecStart` | Runs `packages/podcast-host/dist/supervisor.js` under `VMP_ROOT` | Uses `NODE_BIN` and `VMP_ROOT` from environment |

Example overrides in `/etc/vmp/env` for a system Node install at `/opt/vmp`:

```ini
VMP_ROOT=/opt/vmp
NODE_BIN=/usr/bin/node
NPM_BIN=/usr/bin/npm
```

Stable symlinks (optional): `sudo ln -sf "$(which node)" /usr/local/bin/vmp-node` and set `NODE_BIN=/usr/local/bin/vmp-node` so upgrades do not require editing the unit.

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

See `packages/podcast-host/README.md` and root `AGENTS.md` for the full list of optional settings (Brevo, Stripe callbacks, preview MP3, etc.).

## Enable and start

```bash
sudo systemctl enable --now vmp-supervisor
sudo systemctl status vmp-supervisor
```

## Logs

```bash
journalctl -u vmp-supervisor -f
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

If a job exceeds that threshold, the supervisor **stops** sending `WATCHDOG=1`. With `WatchdogSec=60`, systemd treats the service as failed and **automatically restarts it after 60 seconds**. That restart is intentional recovery from a stuck encode/upload.
