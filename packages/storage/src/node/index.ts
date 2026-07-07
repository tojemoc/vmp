export type { RcloneProviderConfig } from '../config.js'
import type { RcloneProviderConfig, StorageProviderConfig } from '../config.js'
import { createStorageProvider } from '../config.js'
import { RcloneProvider, type RcloneProviderOptions } from './rcloneProvider.js'
import type { ObjectStorageProvider } from '../types.js'

export type NodeStorageProviderConfig = StorageProviderConfig

export function createNodeStorageProvider(config: NodeStorageProviderConfig): ObjectStorageProvider {
  if (config.type === 'rclone') {
    const options: RcloneProviderOptions = { root: config.root }
    if (config.binary) options.binary = config.binary
    return new RcloneProvider(options)
  }
  return createStorageProvider(config)
}

export { RcloneProvider, type RcloneProviderOptions } from './rcloneProvider.js'
