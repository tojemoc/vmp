export type {
  GetObjectOptions,
  HeadObjectResult,
  ObjectStorageProvider,
  PrimaryHealthTracker,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

export {
  isAvailabilityError,
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

export { createAlwaysHealthyTracker, createNoOpTracker } from './healthTrackers.js'
