import type { ObjectStorageProvider } from '@vmp/storage/worker'
import { wrapR2Bucket } from '@vmp/storage/worker'
import type { R2Bucket } from '@cloudflare/workers-types'

const storageByBucket = new WeakMap<R2Bucket, ObjectStorageProvider>()

export type StorageEnv = {
  BUCKET?: R2Bucket
  STORAGE?: ObjectStorageProvider
}

/** Composition-root accessor: prefer injected STORAGE, else wrap the R2 binding. */
export function getObjectStorage(env: StorageEnv): ObjectStorageProvider | undefined {
  if (env.STORAGE) return env.STORAGE
  if (!env.BUCKET) return undefined
  let cached = storageByBucket.get(env.BUCKET)
  if (!cached) {
    cached = wrapR2Bucket(env.BUCKET)
    storageByBucket.set(env.BUCKET, cached)
  }
  return cached
}

export function hasObjectStorage(env: StorageEnv): boolean {
  return Boolean(getObjectStorage(env))
}
