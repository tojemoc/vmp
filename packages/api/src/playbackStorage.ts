import type { ObjectStorageProvider } from '@vmp/storage/worker';
import {
  createPrivateBucketStorage,
  type PrivateBucketEnv,
} from '@vmp/storage/worker';

/** @deprecated Prefer `PrivateBucketEnv` from `@vmp/storage` — kept for API call-site types. */
export type PlaybackStorageEnv = PrivateBucketEnv;

/**
 * Single-origin object storage for playback and public assets.
 *
 * Production: private B2 when `B2_*` credentials are set.
 * Local Wrangler: R2 binding alone when B2 is unset (dev convenience).
 * Never dual-origin failover (B2 + R2) — that path was removed for Bandwidth Alliance simplicity.
 *
 * Same construction as `@vmp/billing` e-invoice XML (`createPrivateBucketStorage`).
 */
export function createPlaybackStorage(env: PlaybackStorageEnv): ObjectStorageProvider | undefined {
  return createPrivateBucketStorage(env);
}
