import type { R2Bucket } from '@cloudflare/workers-types'
import { createStorageProvider, createNoOpTracker, PrimaryWithFailoverCache } from '@vmp/storage'
import type { ObjectStorageProvider } from '@vmp/storage/worker'
import { wrapR2Bucket } from '@vmp/storage/worker'
import { createDurableObjectHealthTracker, type B2HealthBinding } from './b2PrimaryHealth.js'

export interface PlaybackStorageEnv {
  BUCKET?: R2Bucket
  B2_S3_ENDPOINT?: string
  B2_BUCKET_NAME?: string
  B2_ACCESS_KEY_ID?: string
  B2_SECRET_ACCESS_KEY?: string
  B2_REGION?: string
  B2_PRIMARY_HEALTH?: B2HealthBinding
}

function isB2Configured(env: PlaybackStorageEnv): boolean {
  return Boolean(
    env.B2_BUCKET_NAME?.trim()
    && env.B2_ACCESS_KEY_ID?.trim()
    && env.B2_SECRET_ACCESS_KEY?.trim(),
  )
}

function createR2CacheProvider(env: PlaybackStorageEnv): ObjectStorageProvider | undefined {
  if (!env.BUCKET) return undefined
  return wrapR2Bucket(env.BUCKET)
}

function createB2PrimaryProvider(env: PlaybackStorageEnv): ObjectStorageProvider {
  const config: Parameters<typeof createStorageProvider>[0] = {
    type: 'b2',
    bucket: env.B2_BUCKET_NAME!.trim(),
    accessKeyId: env.B2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.B2_SECRET_ACCESS_KEY!.trim(),
    region: env.B2_REGION?.trim() || 'us-west-004',
    forcePathStyle: true,
  }
  const endpoint = env.B2_S3_ENDPOINT?.trim()
  if (endpoint) config.endpoint = endpoint
  return createStorageProvider(config)
}

/**
 * Playback reads: B2 primary with R2 failover when B2 is configured;
 * otherwise R2 binding only (same as #449 default).
 */
export function createPlaybackStorage(env: PlaybackStorageEnv): ObjectStorageProvider | undefined {
  const cache = createR2CacheProvider(env)
  if (!isB2Configured(env)) {
    return cache
  }
  if (!cache) {
    return createB2PrimaryProvider(env)
  }

  const primary = createB2PrimaryProvider(env)
  const health = env.B2_PRIMARY_HEALTH
    ? createDurableObjectHealthTracker(env.B2_PRIMARY_HEALTH)
    : createNoOpTracker()

  return new PrimaryWithFailoverCache(primary, cache, health, {
    logReplicationFailure(key, err) {
      console.error('[playback-storage] R2 cache replication failed', { key, err })
    },
  })
}
