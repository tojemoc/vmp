export type StorageTier = 'hot' | 'cold'

export interface TrafficCounters {
  rpm1m: number
  rpm10m: number
  rpm24h: number
  lastMinuteBucket: string
  minuteBuckets: number[]
  recentMinuteBuckets: string[]
}

export interface TierMetadata {
  videoId: string
  tier: StorageTier
  createdAt: string
  updatedAt: string
  reason?: string
  counters: TrafficCounters
}

export interface OffloadConfig {
  r2Root: string
  garageRoot: string
  metadataFile: string
  metricsFile: string
  tmpDir: string
  rcloneBinary: string
  keyPrefix: string
  dryRun: boolean
  deleteFromR2AfterDemotion: boolean
  demotion: {
    minAgeDays: number
    maxRequestsPerMinute: number
    maxRequestsPer10Minutes: number
    spikeLookbackMinutes: number
  }
  promotion: {
    burstThresholdPerMinute: number
    sustainedThresholdPer10Minutes: number
  }
}

export interface RequestCounters {
  rpm1m: number
  rpm10m: number
  rpm24h: number
}

export interface PromotionTrigger {
  videoId: string
  reason: string
}
