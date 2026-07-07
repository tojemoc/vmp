import { AgeBasedOffloadPolicy, ObjectOffloadJob } from '@vmp/storage'
import { createNodeStorageProvider } from '@vmp/storage/node'
import type { OffloadConfig } from './types.js'
import { toTieredStorageConfig } from './config.js'

function log(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : ''
  process.stdout.write(`${new Date().toISOString()} [offloading] ${message}${suffix}\n`)
}

export async function runAgeBasedOffload(config: OffloadConfig, signal?: AbortSignal): Promise<number> {
  const tiered = toTieredStorageConfig(config)
  const hot = createNodeStorageProvider(tiered.hot)
  const cold = createNodeStorageProvider(tiered.cold)
  const policy = new AgeBasedOffloadPolicy(tiered.maxHotAgeSeconds)

  const job = new ObjectOffloadJob({
    hot,
    cold,
    policy,
    listPrefix: tiered.listPrefix ?? 'videos',
    deleteHotAfterOffload: tiered.deleteHotAfterOffload ?? config.deleteHotAfterOffload,
    dryRun: config.dryRun,
    signal,
    log,
  })

  const results = await job.run()
  const moved = results.filter((r) => r.moved).length
  log(`offload pass complete moved=${moved} total=${results.length}`)
  return moved
}
