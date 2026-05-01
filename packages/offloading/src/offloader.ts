import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { OffloadConfig, TierMetadata } from './types.js'
import type { MetricsStore } from './metrics-store.js'
import type { StorageClient } from './storage.js'
import type { MetadataStore } from './metadata-store.js'

type IntegrityMode = 'size' | 'sha256'

interface OffloadOptions {
  integrityMode?: IntegrityMode
}

async function fileDigestSha256(path: string): Promise<string> {
  const data = await readFile(path)
  return crypto.createHash('sha256').update(data).digest('hex')
}

async function verifyAsset(
  hotStorage: StorageClient,
  coldStorage: StorageClient,
  hotKey: string,
  coldKey: string,
  integrityMode: IntegrityMode,
): Promise<void> {
  const [hotMeta, coldMeta] = await Promise.all([
    hotStorage.statObject(hotKey),
    coldStorage.statObject(coldKey),
  ])

  if (!hotMeta || !coldMeta) {
    throw new Error(`integrity check failed: missing object hot=${hotKey} cold=${coldKey}`)
  }

  if (hotMeta.size !== coldMeta.size) {
    throw new Error(`integrity check failed: size mismatch hot=${hotMeta.size} cold=${coldMeta.size} key=${hotKey}`)
  }

  if (integrityMode === 'sha256') {
    const [hotTmp, coldTmp] = await Promise.all([
      hotStorage.copyToTemp(hotKey),
      coldStorage.copyToTemp(coldKey),
    ])
    try {
      const [hotDigest, coldDigest] = await Promise.all([
        fileDigestSha256(hotTmp),
        fileDigestSha256(coldTmp),
      ])
      if (hotDigest !== coldDigest) {
        throw new Error(`integrity check failed: digest mismatch key=${hotKey}`)
      }
    } finally {
      await Promise.all([
        hotStorage.cleanupTemp(hotTmp),
        coldStorage.cleanupTemp(coldTmp),
      ])
    }
  }
}

export class TierOffloader {
  constructor(
    private readonly config: OffloadConfig,
    private readonly hotStorage: StorageClient,
    private readonly coldStorage: StorageClient,
    private readonly metadataStore: MetadataStore,
    private readonly metricsStore: MetricsStore,
  ) {}

  private isDemotionEligible(record: TierMetadata): boolean {
    if (record.tier === 'cold') return false

    const ageMs = Date.now() - new Date(record.createdAt).getTime()
    const minAgeMs = this.config.demotion.minAgeDays * 24 * 60 * 60 * 1000
    if (ageMs < minAgeMs) return false

    if (record.counters.rpm1m > this.config.demotion.maxRequestsPerMinute) return false
    if (record.counters.rpm10m > this.config.demotion.maxRequestsPer10Minutes) return false

    return true
  }

  private isPromotionEligible(record: TierMetadata): boolean {
    if (record.tier !== 'cold') return false
    return (
      record.counters.rpm10m >= this.config.promotion.sustainedThresholdPer10Minutes
      || record.counters.rpm1m >= this.config.promotion.burstThresholdPerMinute
    )
  }

  async demoteEligibleVideos(options: OffloadOptions = {}): Promise<string[]> {
    const integrityMode = options.integrityMode ?? 'size'
    const updated: string[] = []
    const all = await this.metadataStore.list()
    for (const record of all) {
      if (!this.isDemotionEligible(record)) continue
      await this.demoteVideo(record.videoId, integrityMode)
      updated.push(record.videoId)
    }
    return updated
  }

  async promoteEligibleVideos(options: OffloadOptions = {}): Promise<string[]> {
    const integrityMode = options.integrityMode ?? 'size'
    const updated: string[] = []
    const all = await this.metadataStore.list()
    for (const record of all) {
      if (!this.isPromotionEligible(record)) continue
      await this.promoteVideo(record.videoId, integrityMode)
      updated.push(record.videoId)
    }
    return updated
  }

  async demoteVideo(videoId: string, integrityMode: IntegrityMode = 'size'): Promise<void> {
    const keyPrefix = this.config.keyPrefix.replace(/\/+$/, '')
    const objectPrefix = `${keyPrefix}/videos/${videoId}`.replace(/^\/+/, '')
    const objects = await this.hotStorage.listObjects(objectPrefix)
    if (objects.length === 0) return
    process.stdout.write(`${new Date().toISOString()} [offloading] demote start video=${videoId} objects=${objects.length}\n`)
    for (const object of objects) {
      process.stdout.write(`${new Date().toISOString()} [offloading] demote copy key=${object.key}\n`)
      await this.hotStorage.copyObject(object.key, this.coldStorage, object.key)
      await verifyAsset(this.hotStorage, this.coldStorage, object.key, object.key, integrityMode)
      if (this.config.deleteFromR2AfterDemotion) {
        await this.hotStorage.deleteObject(object.key)
      }
    }
    await this.metadataStore.upsertTier(videoId, 'cold', 'demotion sweep')
    process.stdout.write(`${new Date().toISOString()} [offloading] demote complete video=${videoId}\n`)
  }

  async promoteVideo(videoId: string, integrityMode: IntegrityMode = 'size'): Promise<void> {
    const keyPrefix = this.config.keyPrefix.replace(/\/+$/, '')
    const objectPrefix = `${keyPrefix}/videos/${videoId}`.replace(/^\/+/, '')
    const objects = await this.coldStorage.listObjects(objectPrefix)
    if (objects.length === 0) return
    process.stdout.write(`${new Date().toISOString()} [offloading] promote start video=${videoId} objects=${objects.length}\n`)
    for (const object of objects) {
      process.stdout.write(`${new Date().toISOString()} [offloading] promote copy key=${object.key}\n`)
      await this.coldStorage.copyObject(object.key, this.hotStorage, object.key)
      await verifyAsset(this.coldStorage, this.hotStorage, object.key, object.key, integrityMode)
    }
    await this.metadataStore.upsertTier(videoId, 'hot', 'promotion sweep')
    process.stdout.write(`${new Date().toISOString()} [offloading] promote complete video=${videoId}\n`)
  }
}
