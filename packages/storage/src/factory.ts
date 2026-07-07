import { S3CompatibleStorageProvider } from './s3-compatible.js'
import type { ObjectStorageProvider, StorageProviderConfig } from './types.js'

const R2_DEFAULT_ENDPOINT = 'https://{account_id}.r2.cloudflarestorage.com'

function resolveEndpoint(config: StorageProviderConfig): string | undefined {
  if (config.endpoint) return config.endpoint
  if (config.type === 'b2') {
    return `https://s3.${config.region ?? 'us-west-004'}.backblazeb2.com`
  }
  if (config.type === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID
    if (accountId) return R2_DEFAULT_ENDPOINT.replace('{account_id}', accountId)
  }
  return undefined
}

function resolveCredentials(config: StorageProviderConfig): {
  accessKeyId?: string
  secretAccessKey?: string
} {
  if (config.accessKeyId && config.secretAccessKey) {
    return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  }
  if (config.type === 'r2') {
    return {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
    }
  }
  if (config.type === 'b2') {
    return {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
    }
  }
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
}

export function createStorageProvider(config: StorageProviderConfig): ObjectStorageProvider {
  const id = config.type === 's3-compatible' ? (config.id ?? 's3-compatible') : config.type
  const credentials = resolveCredentials(config)
  return new S3CompatibleStorageProvider({
    id,
    bucket: config.bucket,
    region: config.region ?? (config.type === 'b2' ? 'us-west-004' : 'auto'),
    endpoint: resolveEndpoint(config),
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    forcePathStyle: config.forcePathStyle ?? config.type !== 'r2',
  })
}

export function createStorageProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorageProvider {
  const type = (env.STORAGE_PROVIDER ?? 'r2').trim().toLowerCase()
  const bucket =
    env.S3_BUCKET_NAME ??
    env.R2_BUCKET_NAME ??
    env.STORAGE_BUCKET ??
  'vmp-videos'

  if (type === 'b2') {
    return createStorageProvider({
      type: 'b2',
      bucket,
      region: env.B2_REGION ?? env.AWS_REGION,
      endpoint: env.B2_ENDPOINT ?? env.S3_ENDPOINT,
      accessKeyId: env.B2_ACCESS_KEY_ID,
      secretAccessKey: env.B2_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === '1',
    })
  }

  if (type === 's3-compatible') {
    return createStorageProvider({
      type: 's3-compatible',
      id: env.STORAGE_PROVIDER_ID ?? 's3-compatible',
      bucket,
      region: env.AWS_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === '1',
    })
  }

  return createStorageProvider({
    type: 'r2',
    bucket,
    region: env.AWS_REGION ?? 'auto',
    endpoint: env.S3_ENDPOINT ?? env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === '1',
  })
}
