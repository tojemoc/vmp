/**
 * Object storage for e-invoice XML on the billing Worker.
 * Uses the same R2 bucket binding as `@vmp/api` (`BUCKET` → `vmp-videos`).
 */
import type { ObjectStorageProvider } from '@vmp/storage/worker';
import { wrapR2Bucket } from '@vmp/storage/worker';

export type BillingStorageEnv = {
  BUCKET?: R2Bucket;
  STORAGE?: ObjectStorageProvider;
};

export function getObjectStorage(env: BillingStorageEnv): ObjectStorageProvider | undefined {
  if (env.STORAGE) return env.STORAGE;
  if (env.BUCKET) return wrapR2Bucket(env.BUCKET);
  return undefined;
}

export function hasObjectStorage(env: BillingStorageEnv): boolean {
  return Boolean(getObjectStorage(env));
}
