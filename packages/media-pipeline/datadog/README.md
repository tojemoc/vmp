# Datadog on the transcoding VM

The media-pipeline package emits **DogStatsD metrics** from Node and writes structured logs to stdout (journald). Install the [Datadog Agent](https://docs.datadoghq.com/agent/) on the media VM and apply the templates in this directory.

## Quick install

```bash
# 1. Install Datadog Agent (Debian/Ubuntu example)
DD_API_KEY=<your-api-key> DD_SITE="datadoghq.eu" bash -c "$(curl -L https://install.datadoghq.com/scripts/install_script.sh)"

# 2. Copy integration configs
sudo cp packages/media-pipeline/datadog/conf.d/vmp.d/conf.yaml /etc/datadog-agent/conf.d/vmp.d/conf.yaml
sudo cp packages/media-pipeline/datadog/conf.d/process.d/conf.yaml /etc/datadog-agent/conf.d/process.d/conf.yaml

# 3. Enable DogStatsD + logs in /etc/datadog-agent/datadog.yaml (see datadog.yaml.snippet)
sudo systemctl restart datadog-agent

# 4. Ensure transcoder env enables metrics (default on)
# In /etc/vmp/env:
#   DD_METRICS_ENABLED=1
#   DD_ENV=production
#   DD_SERVICE=vmp-transcoder
```

## Metrics (DogStatsD)

Emitted by `packages/media-pipeline/metrics.ts` — no npm dependency; UDP to `127.0.0.1:8125`.

| Metric | Type | Source | Description |
|--------|------|--------|-------------|
| `vmp.transcoder.queue.depth` | gauge | pipeline_watch | Jobs waiting in memory queue |
| `vmp.transcoder.jobs.active` | gauge | pipeline_watch | Jobs currently processing |
| `vmp.transcoder.job.started` | counter | pipeline_watch | Job began processing |
| `vmp.transcoder.job.success` | counter | pipeline_watch | Job completed successfully |
| `vmp.transcoder.job.failed` | counter | pipeline_watch | Job failed (non-cancel) |
| `vmp.transcoder.job.duration_ms` | histogram | pipeline_watch | Wall-clock job duration |
| `vmp.transcoder.ttp.minimal_publish_ms` | histogram | ttpLog | Inbox → 720p on R2 |
| `vmp.transcoder.ttp.full_renditions_ms` | histogram | ttpLog | Inbox → all renditions on R2 |
| `vmp.transcoder.ttp.total_ms` | histogram | ttpLog | Inbox → pipeline done/failed |
| `vmp.supervisor.pipeline_child.alive` | gauge | supervisor | 1 if pipeline_watch child running |
| `vmp.supervisor.preview_queue.depth` | gauge | supervisor | Preview MP3 jobs queued |
| `vmp.supervisor.gpu_slots.used` | gauge | supervisor | Encode slots in use |
| `vmp.supervisor.upload_slots.used` | gauge | supervisor | Upload slots in use |
| `vmp.supervisor.pipeline.restart` | counter | supervisor | pipeline_watch child restarted |

Disable metrics without removing the agent: `DD_METRICS_ENABLED=0` in `/etc/vmp/env`.

## Logs

**Option A — journald (recommended, no code change):** the shipped `vmp.d` integration tails `journalctl -u vmp-supervisor`. Structured lines (`VMP_TTP`, `VMP_PIPELINE_EVENT`, `VMP_PIPELINE_PROGRESS`) are parseable in Datadog Grok pipelines.

**Option B — log file:** use the optional systemd drop-in `systemd/vmp-supervisor-logfile.conf.example` to append stdout to `/var/log/vmp/supervisor.log`, then uncomment the file source in `conf.d/vmp.d/conf.yaml`.

Set `VMP_TTP_LOG_PATH=/var/log/vmp/ttp.jsonl` for a dedicated TTP JSONL file (also tailable by the agent).

## Process checks

`conf.d/process.d/conf.yaml` monitors:

- `vmp-supervisor` (Node supervisor)
- `pipeline_watch` child
- `ffmpeg` (active encodes)

Adjust `VMP_ROOT` / `NODE_BIN` in the process check patterns if your install path differs from `/root/vmp`.

## Suggested monitors

Once data flows, create these in Datadog (thresholds are starting points — tune per deployment):

| Monitor | Type | Query / condition |
|---------|------|-------------------|
| Worker 5xx spike | Log or CF integration | `status:error` on Workers, rate > 1% over 5m |
| Worker p99 CPU | Cloudflare integration | CPU time p99 climbing vs baseline |
| D1 query slowness | Custom metric / log | `d1_query_ms` p95 > 50ms (from Worker logger) |
| KV write failures | Log | `event:kv_write_failed` or similar |
| Transcode job failures | Metric | `sum:vmp.transcoder.job.failed{*}.as_count()` > N in 15m |
| Consecutive transcode failures | Metric | Alert if `job.failed` increments without `job.success` between |
| Transcoder process down | Process check | `process.up` for `vmp-supervisor` < 1 |
| Pipeline child missing | Metric | `vmp.supervisor.pipeline_child.alive` < 1 for 2m |
| Queue backlog | Metric | `vmp.transcoder.queue.depth` > 10 for 30m |

## Grok parsers (logs)

For journald/file logs, add a pipeline rule to parse tab-separated events:

```
VMP_PIPELINE_EVENT  → extract videoId, stage, status, detail
VMP_TTP             → json_rule on the JSON payload after the tab
```

Worker API JSON logs use a separate pipeline (`source:cloudflare-workers`, `json_rule %{data::json}`) — see `packages/api/src/logger.ts`.
