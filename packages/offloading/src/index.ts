import { loadConfig } from './config.js'
import { MetricsStore } from './metrics-store.js'
import { MetadataStore } from './metadata-store.js'
import { TierOffloader } from './offloader.js'
import { runAgeBasedOffload } from './objectOffloadJob.js'
import { StorageClient } from './storage.js'
import type { PromotionTrigger } from './types.js'

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} [offloading] ${message}\n`)
}

function parsePromotionTrigger(raw: string | undefined): PromotionTrigger | null {
  if (!raw || raw.trim().length === 0) return null
  const [videoId] = raw.split(':')
  const cleanId = videoId?.trim()
  if (!cleanId) {
    throw new Error('Promotion trigger requires non-empty video id')
  }
  return { videoId: cleanId, reason: 'manual' }
}

async function main(): Promise<void> {
  const config = loadConfig()
  log(`config r2Root=${config.r2Root} garageRoot=${config.garageRoot} listPrefix=${config.listPrefix} maxHotAgeSeconds=${config.maxHotAgeSeconds} deleteHotAfterOffload=${config.deleteHotAfterOffload}`)

  const abortController = new AbortController()
  const onSignal = (signal: NodeJS.Signals): void => {
    abortController.abort()
    log(`received ${signal}; finishing current operation then exiting`)
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))

  const mode = process.argv[2]
  if (!mode) {
    console.error('Usage: <cmd> <mode>')
    console.error('Available modes: offload | demote-legacy | promote | trigger-promote')
    process.exit(1)
  }

  if (mode === 'offload' || mode === 'demote') {
    const moved = await runAgeBasedOffload(config, abortController.signal)
    log(`offloaded objects: ${moved}`)
    return
  }

  // Legacy video-level demotion/promotion using metadata store + traffic counters.
  const metadata = new MetadataStore(config.metadataFile)
  const metrics = new MetricsStore(config.metricsFile)
  const hotStorage = new StorageClient(config.r2Root, config.rcloneBinary)
  const coldStorage = new StorageClient(config.garageRoot, config.rcloneBinary)
  const offloader = new TierOffloader(config, hotStorage, coldStorage, metadata, metrics)

  if (mode === 'demote-legacy') {
    const demoted = await offloader.demoteEligibleVideos({
      integrityMode: 'size',
      signal: abortController.signal,
    })
    log(`legacy demoted videos: ${demoted.length}`)
    return
  }
  if (mode === 'promote') {
    const promoted = await offloader.promoteEligibleVideos({
      integrityMode: 'size',
      signal: abortController.signal,
    })
    log(`promoted videos: ${promoted.length}`)
    return
  }
  if (mode === 'trigger-promote') {
    const trigger = parsePromotionTrigger(process.argv[3])
    if (!trigger) {
      throw new Error('Usage: node dist/index.js trigger-promote <videoId>')
    }
    await offloader.promoteVideo(trigger.videoId, 'size', abortController.signal)
    log(`promoted video: ${trigger.videoId}`)
    return
  }
  throw new Error('Unknown mode. Use one of: offload | demote | demote-legacy | promote | trigger-promote')
}

main().catch((error) => {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  log(`fatal: ${detail}`)
  process.exit(1)
})
