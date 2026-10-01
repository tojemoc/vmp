import type { R2Bucket } from '@cloudflare/workers-types';
import { createStorageProvider } from '@vmp/storage';
import type { ObjectStorageProvider } from '@vmp/storage/worker';
import { wrapR2Bucket } from '@vmp/storage/worker';

export interface PlaybackStorageEnv {
  BUCKET?: R2Bucket;
  B2_S3_ENDPOINT?: string;
  B2_BUCKET_NAME?: string;
  B2_ACCESS_KEY_ID?: string;
  B2_SECRET_ACCESS_KEY?: string;
  B2_REGION?: string;
}

function isB2Configured(env: PlaybackStorageEnv): boolean {
  return Boolean(
    env.B2_BUCKET_NAME?.trim() && env.B2_ACCESS_KEY_ID?.trim() && env.B2_SECRET_ACCESS_KEY?.trim(),
  );
}

function createB2Provider(env: PlaybackStorageEnv): ObjectStorageProvider {
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
 * Single-origin object storage for playback and public assets.
 *
 * Production: private B2 when `B2_*` credentials are set.
 * Local Wrangler: R2 binding alone when B2 is unset (dev convenience).
 * Never dual-origin failover (B2 + R2) — that path was removed for Bandwidth Alliance simplicity.
 */
export function createPlaybackStorage(env: PlaybackStorageEnv): ObjectStorageProvider | undefined {
  if (isB2Configured(env)) {
    return createB2Provider(env);
  }
  if (env.BUCKET) {
    return wrapR2Bucket(env.BUCKET);
  }
  return undefined;
}
