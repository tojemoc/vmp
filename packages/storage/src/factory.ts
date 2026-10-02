import { S3CompatibleStorageProvider } from './s3-compatible.js';
import type { ObjectStorageProvider, StorageProviderConfig } from './types.js';

const R2_DEFAULT_ENDPOINT = 'https://{account_id}.r2.cloudflarestorage.com';

function resolveEndpoint(config: StorageProviderConfig): string | undefined {
  if (config.endpoint) return config.endpoint;
  if (config.type === 'b2') {
    return `https://s3.${config.region ?? 'us-west-004'}.backblazeb2.com`;
  }
  if (config.type === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    if (accountId) return R2_DEFAULT_ENDPOINT.replace('{account_id}', accountId);
  }
  return undefined;
}

function resolveCredentials(config: StorageProviderConfig): {
  accessKeyId?: string;
  secretAccessKey?: string;
} {
  if (config.accessKeyId && config.secretAccessKey) {
    return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  }
  if (config.type === 'r2') {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
    return {
      ...(accessKeyId !== undefined ? { accessKeyId } : {}),
      ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
    };
  }
  if (config.type === 'b2') {
    const accessKeyId = process.env.B2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.B2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
    return {
      ...(accessKeyId !== undefined ? { accessKeyId } : {}),
      ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
    };
  }
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  return {
    ...(accessKeyId !== undefined ? { accessKeyId } : {}),
    ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
  };
}

export function createStorageProvider(config: StorageProviderConfig): ObjectStorageProvider {
  const id = config.type === 's3-compatible' ? (config.id ?? 's3-compatible') : config.type;
  const credentials = resolveCredentials(config);
  const endpoint = resolveEndpoint(config);
  return new S3CompatibleStorageProvider({
    id,
    bucket: config.bucket,
    region: config.region ?? (config.type === 'b2' ? 'us-west-004' : 'auto'),
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(credentials.accessKeyId !== undefined ? { accessKeyId: credentials.accessKeyId } : {}),
    ...(credentials.secretAccessKey !== undefined
      ? { secretAccessKey: credentials.secretAccessKey }
      : {}),
    forcePathStyle: config.forcePathStyle ?? config.type !== 'r2',
    ...(config.requestTimeoutMs !== undefined ? { requestTimeoutMs: config.requestTimeoutMs } : {}),
  });
}

/** Parse `s3://bucket/prefix` → bucket name (encore-packager PACKAGE_OUTPUT_FOLDER). */
export function bucketNameFromS3Uri(uri: string | undefined): string | undefined {
  const raw = typeof uri === 'string' ? uri.trim() : '';
  if (!raw) return undefined;
  const match = /^s3:\/\/([^/?#]+)/i.exec(raw);
  const name = match?.[1]?.trim();
  return name || undefined;
}

function resolveBucketName(env: NodeJS.ProcessEnv): string {
  return (
    env.S3_BUCKET_NAME?.trim() ||
    env.B2_BUCKET_NAME?.trim() ||
    env.R2_BUCKET_NAME?.trim() ||
    env.STORAGE_BUCKET?.trim() ||
    bucketNameFromS3Uri(env.PACKAGE_OUTPUT_FOLDER) ||
    'vmp-videos'
  );
}

/** Prefer explicit provider endpoints; accept packager's `S3_ENDPOINT_URL` alias. */
function resolveS3Endpoint(env: NodeJS.ProcessEnv, type: string): string | undefined {
  if (type === 'b2') {
    return (
      env.B2_S3_ENDPOINT?.trim() ||
      env.B2_ENDPOINT?.trim() ||
      env.S3_ENDPOINT?.trim() ||
      env.S3_ENDPOINT_URL?.trim() ||
      undefined
    );
  }
  return (
    env.S3_ENDPOINT?.trim() ||
    env.S3_ENDPOINT_URL?.trim() ||
    env.R2_ENDPOINT?.trim() ||
    undefined
  );
}

export function createStorageProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageProvider {
  const type = (env.STORAGE_PROVIDER ?? 'r2').trim().toLowerCase();
  const bucket = resolveBucketName(env);

  if (type === 'b2') {
    const endpoint = resolveS3Endpoint(env, 'b2');
    const accessKeyId = env.B2_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.B2_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
    return createStorageProvider({
      type: 'b2',
      bucket,
      ...(env.B2_REGION !== undefined ? { region: env.B2_REGION } : {}),
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(accessKeyId !== undefined ? { accessKeyId } : {}),
      ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === '0' ? false : true,
    });
  }

  if (type === 's3-compatible') {
    const region = env.AWS_REGION;
    const endpoint = resolveS3Endpoint(env, 's3-compatible');
    return createStorageProvider({
      type: 's3-compatible',
      id: env.STORAGE_PROVIDER_ID ?? 's3-compatible',
      bucket,
      ...(region !== undefined ? { region } : {}),
      ...(endpoint !== undefined ? { endpoint } : {}),
      ...(env.AWS_ACCESS_KEY_ID !== undefined ? { accessKeyId: env.AWS_ACCESS_KEY_ID } : {}),
      ...(env.AWS_SECRET_ACCESS_KEY !== undefined
        ? { secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
        : {}),
      ...(env.S3_FORCE_PATH_STYLE === '1' ? { forcePathStyle: true } : {}),
    });
  }

  const region = env.AWS_REGION ?? 'auto';
  const endpoint = resolveS3Endpoint(env, 'r2');
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
  return createStorageProvider({
    type: 'r2',
    bucket,
    region,
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(accessKeyId !== undefined ? { accessKeyId } : {}),
    ...(secretAccessKey !== undefined ? { secretAccessKey } : {}),
    ...(env.S3_FORCE_PATH_STYLE === '1' ? { forcePathStyle: true } : {}),
  });
}
