import type { OffloadConfig } from './types.js'

function env(name: string, fallback = ''): string {
  const raw = process.env[name]
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback
}

function envNumber(name: string, fallback: number, min = Number.NEGATIVE_INFINITY): number {
  const raw = process.env[name]
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

export function loadConfig(): OffloadConfig {
  return {
    r2Root: env('OFFLOAD_R2_ROOT', 'vmp-videos:'),
    garageRoot: env('OFFLOAD_GARAGE_ROOT', 'garage-videos:'),
    metadataFile: env('OFFLOAD_METADATA_FILE', '/var/lib/vmp-offloading/video-tier-state.json'),
    metricsFile: env('OFFLOAD_METRICS_FILE', '/var/lib/vmp-offloading/video-traffic-metrics.json'),
    tmpDir: env('OFFLOAD_TMP_DIR', '/tmp/vmp-offloading'),
    rcloneBinary: env('OFFLOAD_RCLONE_BIN', 'rclone'),
    keyPrefix: env('OFFLOAD_KEY_PREFIX', 'videos'),
    dryRun: env('OFFLOAD_DRY_RUN', '0') === '1',
    deleteFromR2AfterDemotion: env('OFFLOAD_DELETE_FROM_R2', '0') === '1',
    demotion: {
      minAgeDays: envNumber('OFFLOAD_RETENTION_DAYS', 45, 1),
      maxRequestsPerMinute: envNumber('OFFLOAD_DEMOTION_MAX_RPM_1M', 1, 0),
      maxRequestsPer10Minutes: envNumber('OFFLOAD_DEMOTION_MAX_RPM_10M', 5, 0),
      spikeLookbackMinutes: envNumber('OFFLOAD_SPIKE_WINDOW_MINUTES', 60, 1),
    },
    promotion: {
      burstThresholdPerMinute: envNumber('OFFLOAD_PROMOTION_BURST_RPM', 8, 0),
      sustainedThresholdPer10Minutes: envNumber('OFFLOAD_PROMOTION_10M', 40, 0),
    },
  }
}
