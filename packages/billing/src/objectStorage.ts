/**
 * Object storage for e-invoice XML on the billing Worker.
 *
 * Same private bucket as `@vmp/api` (`videos/`, `thumbnails/`, `einvoices/…`).
 * Production: B2 via `B2_*` secrets. Local Wrangler: R2 `BUCKET` when B2 unset.
 * Invoice XML is never served via public bucket URLs or `/api/assets` (not allowlisted).
 */
import type { ObjectStorageProvider } from '@vmp/storage/worker';
import {
  createPrivateBucketStorage,
  type PrivateBucketEnv,
} from '@vmp/storage/worker';

export type BillingStorageEnv = PrivateBucketEnv;

export function getObjectStorage(env: BillingStorageEnv): ObjectStorageProvider | undefined {
  return createPrivateBucketStorage(env);
}

export function hasObjectStorage(env: BillingStorageEnv): boolean {
  return Boolean(getObjectStorage(env));
}
