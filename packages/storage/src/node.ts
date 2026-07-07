export * from './types.js'
export { S3CompatibleStorageProvider } from './s3-compatible.js'
export { createStorageProvider, createStorageProviderFromEnv } from './factory.js'
export { asR2Bucket, ObjectStorageR2BucketBridge } from './r2-bucket-bridge.js'
export { uploadLocalDirectory, uploadLocalFile, verifyRemoteDirectory } from './upload-helpers.js'
export { RcloneProvider, type RcloneProviderOptions } from './rclone-provider.js'
import { createStorageProvider } from './factory.js'
import { RcloneProvider } from './rclone-provider.js'
import type { NodeStorageProviderConfig, ObjectStorageProvider } from './types.js'

export function createNodeStorageProvider(config: NodeStorageProviderConfig): ObjectStorageProvider {
  if (config.type === 'rclone') {
    const options: { root: string; binary?: string } = { root: config.root }
    if (config.binary) options.binary = config.binary
    return new RcloneProvider(options)
  }
  return createStorageProvider(config)
}
