import type { R2Bucket } from '@cloudflare/workers-types'
import {
  createNoOpTracker,
  PrimaryWithFailoverCache,
  R2BindingProvider,
  R2HttpProvider,
  S3FetchProvider,
  type ObjectStorageProvider,
} from '@vmp/storage'
import { createDurableObjectHealthTracker, type B2HealthBinding } from './b2PrimaryHealth.js'

export interface PlaybackStorageEnv {
  BUCKET?: R2Bucket
  R2_BASE_URL?: string
  B2_S3_ENDPOINT?: string
  B2_BUCKET_NAME?: string
  B2_ACCESS_KEY_ID?: string
  B2_SECRET_ACCESS_KEY?: string
  B2_REGION?: string
  B2_PRIMARY_HEALTH?: B2HealthBinding
}

function createR2CacheProvider(env: PlaybackStorageEnv): ObjectStorageProvider {
  if (env.BUCKET) return new R2BindingProvider(env.BUCKET)
  const baseUrl = (env.R2_BASE_URL ?? '').trim()
  if (!baseUrl) {
    throw new Error('Playback storage requires BUCKET binding or R2_BASE_URL')
  }
  return new R2HttpProvider(baseUrl)
}

function isB2Configured(env: PlaybackStorageEnv): boolean {
  return Boolean(
    env.B2_S3_ENDPOINT?.trim()
    && env.B2_BUCKET_NAME?.trim()
    && env.B2_ACCESS_KEY_ID?.trim()
    && env.B2_SECRET_ACCESS_KEY?.trim(),
  )
}

function createB2PrimaryProvider(env: PlaybackStorageEnv): ObjectStorageProvider {
  return new S3FetchProvider({
    endpoint: env.B2_S3_ENDPOINT!.trim(),
    bucket: env.B2_BUCKET_NAME!.trim(),
    accessKeyId: env.B2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.B2_SECRET_ACCESS_KEY!.trim(),
    region: env.B2_REGION?.trim() || 'us-east-1',
  })
}

/**
 * Playback reads: B2 primary with R2 failover when B2 is configured;
 * otherwise legacy R2-only (binding preferred, HTTP fallback).
 */
export function createPlaybackStorage(env: PlaybackStorageEnv): ObjectStorageProvider {
  const cache = createR2CacheProvider(env)
  if (!isB2Configured(env)) {
    return cache
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
