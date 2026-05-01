# Docker/Compose deployment recommendations

## Compose snippet

```yaml
services:
  podcast-host:
    image: ghcr.io/ORG/vmp-podcast-host:${TAG}
    restart: unless-stopped
    stop_grace_period: 45s
    environment:
      INBOX_DIR: /data/inbox
      TMP_DIR_BASE: /data/tmp
      VMP_UI_HOST: 0.0.0.0
      VMP_UI_PORT: 8788
      VMP_RUN_PIPELINE: "1"
    volumes:
      - ./volumes/inbox:/data/inbox
      - ./volumes/tmp:/data/tmp
      - ./volumes/podcast-metadata:/data/meta
  offloading:
    image: ghcr.io/ORG/vmp-offloading:${TAG}
    restart: unless-stopped
    stop_grace_period: 45s
    command: ["node", "dist/index.js", "demote"]
    environment:
      OFFLOAD_METADATA_FILE: /data/meta/tier-metadata.json
      OFFLOAD_METRICS_FILE: /data/meta/offload-metrics.json
      OFFLOAD_R2_ROOT: /data/r2
      OFFLOAD_GARAGE_ROOT: /data/garage
    volumes:
      - ./volumes/offloading-meta:/data/meta
      - ./volumes/r2:/data/r2
      - ./volumes/garage:/data/garage
```

## Persistence guidance

- Keep metadata and metrics files on persistent bind mounts.
- Keep inbox/tmp bind-mounted to avoid data loss on restart.
- Use non-root UID/GID in runtime environment where possible.
- Keep hot/cold object stores on separate persistent volumes.
