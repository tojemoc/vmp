import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { NodeEnv } from '../types.js'

/**
 * Sync HLS manifest objects from R2 (via S3-compatible endpoint) into the primary S3 bucket.
 * Segments are intentionally excluded — manifests only.
 *
 * TODO: configure dual-write from podcast-host so S3 stays current without this job.
 */
export async function syncR2ManifestsToS3(env: NodeEnv): Promise<{ ok: boolean; synced: number; error?: string }> {
  const bucket = env.S3_BUCKET_NAME ?? process.env.S3_BUCKET_NAME
  const r2Endpoint = process.env.R2_S3_ENDPOINT
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY

  if (!bucket || !r2Endpoint || !r2AccessKey || !r2SecretKey) {
    return { ok: false, synced: 0, error: 'R2/S3 sync credentials not configured' }
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
          Bucket: process.env.R2_BUCKET_NAME ?? 'vmp-videos',
          Prefix: 'videos/',
          ContinuationToken: continuationToken,
        }),
      )
      for (const obj of listed.Contents ?? []) {
        const key = obj.Key
        if (!key || !key.endsWith('.m3u8')) continue
        const got = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME ?? 'vmp-videos', Key: key }))
        const body = await got.Body?.transformToByteArray()
        if (!body) continue
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/vnd.apple.mpegurl',
          }),
        )
        synced++
      }
      continuationToken = listed.NextContinuationToken
    } while (continuationToken)
    return { ok: true, synced }
  } catch (err) {
    return { ok: false, synced, error: err instanceof Error ? err.message : String(err) }
  }
}
