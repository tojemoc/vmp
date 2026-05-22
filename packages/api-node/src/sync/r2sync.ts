import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { NodeEnv } from '../types.js'

const MAX_PUT_ATTEMPTS = 3

async function putWithRetry(
  s3: S3Client,
  params: { Bucket: string; Key: string; Body: Uint8Array; ContentType: string },
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
    try {
      await s3.send(new PutObjectCommand(params))
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
 *
 * TODO: configure dual-write from podcast-host so S3 stays current without this job.
 */
export async function syncR2ManifestsToS3(env: NodeEnv): Promise<{ ok: boolean; synced: number; error?: string }> {
  const bucket = env.S3_BUCKET_NAME ?? process.env.S3_BUCKET_NAME
  const r2Bucket = process.env.R2_BUCKET_NAME
  const r2Endpoint = process.env.R2_S3_ENDPOINT
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY

  if (!bucket || !r2Endpoint || !r2AccessKey || !r2SecretKey) {
    return { ok: false, synced: 0, error: 'R2/S3 sync credentials not configured' }
  }
  if (!r2Bucket) {
    return { ok: false, synced: 0, error: 'R2_BUCKET_NAME is required for manifest sync' }
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2SecretKey },
    forcePathStyle: true,
  })
  const s3 = new S3Client({
    region: env.AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  })

  let synced = 0
  let continuationToken: string | undefined
  try {
    do {
      const listed = await r2.send(
        new ListObjectsV2Command({
          Bucket: r2Bucket,
          Prefix: 'videos/',
          ContinuationToken: continuationToken,
        }),
      )
      for (const obj of listed.Contents ?? []) {
        const key = obj.Key
        if (!key || !key.endsWith('.m3u8')) continue
        try {
          const got = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }))
          const body = await got.Body?.transformToByteArray()
          if (!body) continue
          await putWithRetry(s3, {
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/vnd.apple.mpegurl',
          })
          synced++
        } catch (err) {
          console.error(`[r2sync] failed to sync manifest ${key}:`, err)
        }
      }
      continuationToken = listed.NextContinuationToken
    } while (continuationToken)
    return { ok: true, synced }
  } catch (err) {
    return { ok: false, synced, error: err instanceof Error ? err.message : String(err) }
  }
}
