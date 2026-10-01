/**
 * Single-origin private bucket for Workers (API + billing).
 *
 * Production: Backblaze B2 via `B2_*` secrets.
 * Local Wrangler: R2 `BUCKET` binding when B2 is unset.
 * Never dual-origin failover — clients never fetch a public bucket URL.
 */
import type { R2Bucket } from '@cloudflare/workers-types';
import { createStorageProvider } from './factory.js';
import { wrapR2Bucket } from './r2-binding.js';
import type { ObjectStorageProvider } from './types.js';

export type PrivateBucketEnv = {
  BUCKET?: R2Bucket;
  /** Test / DI override — preferred when set. */
  STORAGE?: ObjectStorageProvider;
  B2_S3_ENDPOINT?: string;
  B2_BUCKET_NAME?: string;
  B2_ACCESS_KEY_ID?: string;
  B2_SECRET_ACCESS_KEY?: string;
  B2_REGION?: string;
};

export function isB2Configured(env: PrivateBucketEnv): boolean {
  return Boolean(
    env.B2_BUCKET_NAME?.trim() && env.B2_ACCESS_KEY_ID?.trim() && env.B2_SECRET_ACCESS_KEY?.trim(),
  );
}

function createB2Provider(env: PrivateBucketEnv): ObjectStorageProvider {
  const config: Parameters<typeof createStorageProvider>[0] = {
    type: 'b2',
    bucket: env.B2_BUCKET_NAME!.trim(),
    accessKeyId: env.B2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.B2_SECRET_ACCESS_KEY!.trim(),
    region: env.B2_REGION?.trim() || 'us-west-004',
    forcePathStyle: true,
  };
  const endpoint = env.B2_S3_ENDPOINT?.trim();
  if (endpoint) config.endpoint = endpoint;
  return createStorageProvider(config);
}

/**
 * Resolve the Worker object-storage provider for the private media/invoice bucket.
 */
export function createPrivateBucketStorage(
  env: PrivateBucketEnv,
): ObjectStorageProvider | undefined {
  if (env.STORAGE) return env.STORAGE;
  if (isB2Configured(env)) return createB2Provider(env);
  if (env.BUCKET) return wrapR2Bucket(env.BUCKET);
  return undefined;
}
