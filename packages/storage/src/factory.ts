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
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
    return {
      ...(accessKeyId !== undefined ? { accessKeyId } : {}),
      ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
    }
  }
  if (config.type === 'b2') {
    const accessKeyId = process.env.B2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = process.env.B2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
    return {
      ...(accessKeyId !== undefined ? { accessKeyId } : {}),
      ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
    }
  }
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  return {
    ...(accessKeyId !== undefined ? { accessKeyId } : {}),
    ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
  }
}

export function createStorageProvider(config: StorageProviderConfig): ObjectStorageProvider {
  const id = config.type === 's3-compatible' ? (config.id ?? 's3-compatible') : config.type
  const credentials = resolveCredentials(config)
  const endpoint = resolveEndpoint(config)
  return new S3CompatibleStorageProvider({
    id,
    bucket: config.bucket,
    region: config.region ?? (config.type === 'b2' ? 'us-west-004' : 'auto'),
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(credentials.accessKeyId !== undefined ? { accessKeyId: credentials.accessKeyId } : {}),
    ...(credentials.secretAccessKey !== undefined ? { secretAccessKey: credentials.secretAccessKey } : {}),
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
    const region = env.B2_REGION ?? env.AWS_REGION
    const endpoint = env.B2_ENDPOINT ?? env.S3_ENDPOINT
    return createStorageProvider({
      type: 'b2',
      bucket,
      ...(region !== undefined ? { region } : {}),
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(env.B2_ACCESS_KEY_ID !== undefined ? { accessKeyId: env.B2_ACCESS_KEY_ID } : {}),
      ...(env.B2_SECRET_ACCESS_KEY !== undefined ? { secretAccessKey: env.B2_SECRET_ACCESS_KEY } : {}),
      ...(env.S3_FORCE_PATH_STYLE === '1' ? { forcePathStyle: true } : {}),
    })
  }

  if (type === 's3-compatible') {
    const region = env.AWS_REGION
    const endpoint = env.S3_ENDPOINT
    return createStorageProvider({
      type: 's3-compatible',
      id: env.STORAGE_PROVIDER_ID ?? 's3-compatible',
      bucket,
      ...(region !== undefined ? { region } : {}),
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(env.AWS_ACCESS_KEY_ID !== undefined ? { accessKeyId: env.AWS_ACCESS_KEY_ID } : {}),
      ...(env.AWS_SECRET_ACCESS_KEY !== undefined ? { secretAccessKey: env.AWS_SECRET_ACCESS_KEY } : {}),
      ...(env.S3_FORCE_PATH_STYLE === '1' ? { forcePathStyle: true } : {}),
    })
  }

  const region = env.AWS_REGION ?? 'auto'
  const endpoint = env.S3_ENDPOINT ?? env.R2_ENDPOINT
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY
  return createStorageProvider({
    type: 'r2',
    bucket,
    region,
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(accessKeyId !== undefined ? { accessKeyId } : {}),
    ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
    ...(env.S3_FORCE_PATH_STYLE === '1' ? { forcePathStyle: true } : {}),
  })
}
