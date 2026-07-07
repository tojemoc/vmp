import { S3FetchProvider, type S3FetchProviderConfig } from './s3FetchProvider.js'
import { R2HttpProvider } from './r2HttpProvider.js'
import type { ObjectStorageProvider } from './types.js'

export type R2HttpProviderConfig = {
  type: 'r2-http'
  baseUrl: string
}

export type S3CompatibleProviderConfig = {
  type: 's3-compatible' | 'b2'
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export type RcloneProviderConfig = {
  type: 'rclone'
  root: string
  binary?: string
}

export type StorageProviderConfig = R2HttpProviderConfig | S3CompatibleProviderConfig | RcloneProviderConfig

export interface TieredStorageConfig {
  hot: StorageProviderConfig
  cold: StorageProviderConfig
  maxHotAgeSeconds: number
  listPrefix?: string
  deleteHotAfterOffload?: boolean
}

function toS3Config(config: S3CompatibleProviderConfig): S3FetchProviderConfig {
  const out: S3FetchProviderConfig = {
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  }
  if (config.region) out.region = config.region
  return out
}

/** Create a provider for Worker / fetch-based runtimes (no rclone). */
export function createStorageProvider(config: Exclude<StorageProviderConfig, RcloneProviderConfig>): ObjectStorageProvider {
  if (config.type === 'r2-http') {
    return new R2HttpProvider(config.baseUrl)
  }
  return new S3FetchProvider(toS3Config(config))
}
