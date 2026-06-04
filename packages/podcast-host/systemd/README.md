# VMP media host (systemd)

The `vmp-supervisor` unit runs the podcast-host supervisor: local dashboard, preview MP3 webhook, and the `pipeline_watch` child process.

## Install the unit file

```bash
sudo cp packages/podcast-host/systemd/vmp-supervisor.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Adjust paths in the unit file if the repo is not at `/root/vmp` or Node is installed elsewhere.

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

Send SIGTERM so the supervisor shuts down preview children and the pipeline watcher cleanly:

```bash
sudo systemctl kill --signal=SIGTERM vmp-supervisor
```

Or restart after config changes:

```bash
sudo systemctl restart vmp-supervisor
```

The unit uses `Type=notify` with a 60s watchdog. The supervisor sends `READY=1` when the HTTP server is listening and `WATCHDOG=1` every 20 seconds while the pipeline child is healthy and no job has been stuck in `running` longer than `VMP_STUCK_JOB_MINUTES` (default 60).
