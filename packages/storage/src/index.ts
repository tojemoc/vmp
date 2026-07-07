export type {
  GetObjectOptions,
  HeadObjectResult,
  ListedObject,
  ObjectMetadata,
  ObjectStorageProvider,
  PrimaryHealthTracker,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

export {
  isAvailabilityError,
  isNotFoundError,
  isNotFoundHttpStatus,
  StorageAvailabilityError,
  StorageNotFoundError,
} from './errors.js'

export { S3FetchProvider, type S3FetchProviderConfig } from './s3FetchProvider.js'
export { R2BindingProvider } from './r2BindingProvider.js'
export { R2HttpProvider } from './r2HttpProvider.js'
export {
  PrimaryWithFailoverCache,
  type PrimaryWithFailoverCacheOptions,
} from './primaryWithFailoverCache.js'
export { TieredStorageProvider } from './tieredStorageProvider.js'
export { AgeBasedOffloadPolicy, type OffloadPolicy } from './offloadPolicy.js'
export {
  createStorageProvider,
  type StorageProviderConfig,
  type TieredStorageConfig,
  type R2HttpProviderConfig,
  type S3CompatibleProviderConfig,
  type RcloneProviderConfig,
} from './config.js'
export { ObjectOffloadJob, type OffloadMoveResult, type ObjectOffloadJobOptions } from './objectOffloadJob.js'
export { dedupeByKey } from './dedupeByKey.js'

export { createAlwaysHealthyTracker, createNoOpTracker } from './healthTrackers.js'
