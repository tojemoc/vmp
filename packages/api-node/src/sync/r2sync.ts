import { createStorageProvider } from '@vmp/storage/node'
import type { ObjectStorageProvider } from '@vmp/storage/node'

/** Env fields used by optional R2→S3 manifest sync. */
interface R2SyncEnv {
  S3_BUCKET_NAME?: string
  AWS_REGION?: string
}

const MAX_PUT_ATTEMPTS = 3

async function putWithRetry(
  storage: ObjectStorageProvider,
  key: string,
  body: Uint8Array,
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
    try {
      await storage.putObject(key, body, { contentType: 'application/vnd.apple.mpegurl' })
      return
    } catch (err) {
      lastErr = err
      if (attempt < MAX_PUT_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt))
      }
    }
  }
  throw lastErr
}

/**
 * Sync HLS manifest objects from R2 (via S3-compatible endpoint) into the primary S3 bucket.
 * Segments are intentionally excluded — manifests only.
 */
export async function syncR2ManifestsToS3(env: R2SyncEnv): Promise<{ ok: boolean; synced: number; error?: string }> {
  const bucket = env.S3_BUCKET_NAME ?? process.env.S3_BUCKET_NAME
  const r2Bucket = process.env.R2_BUCKET_NAME
  const r2Endpoint = process.env.R2_S3_ENDPOINT ?? process.env.R2_ENDPOINT ?? process.env.S3_ENDPOINT
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY

  if (!bucket || !r2Endpoint || !r2AccessKey || !r2SecretKey) {
    return { ok: false, synced: 0, error: 'R2/S3 sync credentials not configured' }
  }
  if (!r2Bucket) {
    return { ok: false, synced: 0, error: 'R2_BUCKET_NAME is required for manifest sync' }
  }

  const source = createStorageProvider({
    type: 'r2',
    bucket: r2Bucket,
    endpoint: r2Endpoint,
    accessKeyId: r2AccessKey,
    secretAccessKey: r2SecretKey,
    forcePathStyle: true,
  })
  const target = createStorageProvider({
    type: 's3-compatible',
    id: 's3-primary',
    bucket,
    region: env.AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  })

  let synced = 0
  let cursor: string | undefined
  try {
    do {
      if (!source.listObjectsPage) {
        return { ok: false, synced, error: 'Source storage does not support paginated listing' }
      }
      const listed = await source.listObjectsPage({ prefix: 'videos/', cursor })
      for (const obj of listed.objects) {
        const key = obj.key
        if (!key.endsWith('.m3u8')) continue
        try {
          const got = await source.getObject(key)
          if (!got) continue
          const body = new Uint8Array(await new Response(got.body as ReadableStream).arrayBuffer())
          await putWithRetry(target, key, body)
          synced++
        } catch (err) {
          console.error(`[r2sync] failed to sync manifest ${key}:`, err)
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
    return { ok: true, synced }
  } catch (err) {
    return { ok: false, synced, error: err instanceof Error ? err.message : String(err) }
  }
}
