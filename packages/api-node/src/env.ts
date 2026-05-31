import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgresD1Adapter, resolveDatabaseUrl } from './bindings/db.js'
import { S3R2Adapter } from './bindings/bucket.js'
import { PostgresKVAdapter } from './bindings/kv.js'
import { InMemoryDurableObjectNamespace } from './bindings/durableObject.js'
import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import type { CFEnvShape } from './types.js'

const workspaceRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

let cachedEnv: CFEnvShape | null = null
let cachedDb: PostgresD1Adapter | null = null
let cachedKv: PostgresKVAdapter | null = null
let envBuildPromise: Promise<CFEnvShape> | null = null

export function migrationsDir(): string {
  return resolve(workspaceRoot, 'packages/api/migrations')
}

export async function buildEnv(): Promise<CFEnvShape> {
  const databaseUrl = resolveDatabaseUrl()
  const db = new PostgresD1Adapter({
    databaseUrl,
    enableWriteLog: process.env.ENABLE_WRITE_LOG !== '0',
    maxConnections: Number.parseInt(process.env.DATABASE_POOL_SIZE ?? '5', 10) || 5,
  })
  const runMigrations = process.env.RUN_MIGRATIONS !== '0'
  await db.init(runMigrations ? migrationsDir() : undefined)

  const kv = new PostgresKVAdapter(db)

  let bucket: S3R2Adapter | undefined
  if (process.env.S3_BUCKET_NAME) {
    bucket = new S3R2Adapter({
      bucket: process.env.S3_BUCKET_NAME,
      region: process.env.AWS_REGION,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1',
    })
  }

  cachedDb = db
  cachedKv = kv

  const env: CFEnvShape = {
    JWT_SECRET: process.env.JWT_SECRET,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    RSS_SECRET: process.env.RSS_SECRET,
    TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY,
    GOCARDLESS_ACCESS_TOKEN: process.env.GOCARDLESS_ACCESS_TOKEN,
    GOCARDLESS_CREDITOR_ID: process.env.GOCARDLESS_CREDITOR_ID,
    GOCARDLESS_WEBHOOK_SECRET: process.env.GOCARDLESS_WEBHOOK_SECRET,
    FRONTEND_URL: process.env.FRONTEND_URL,
    API_PUBLIC_URL: process.env.API_PUBLIC_URL || process.env.API_URL,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    R2_BASE_URL: process.env.R2_BASE_URL,
    SENDER_EMAIL: process.env.SENDER_EMAIL,
    SENDER_NAME: process.env.SENDER_NAME,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    MEDIA_CONVERT_ENABLED: process.env.MEDIA_CONVERT_ENABLED,
    MEDIA_CONVERT_INPUT_PREFIX: process.env.MEDIA_CONVERT_INPUT_PREFIX,
    MEDIA_CONVERT_OUTPUT_PREFIX: process.env.MEDIA_CONVERT_OUTPUT_PREFIX,
    MEDIA_CONVERT_MAX_UPLOAD_MB: process.env.MEDIA_CONVERT_MAX_UPLOAD_MB,
    MEDIA_CONVERT_PRICE_HD_PER_MIN: process.env.MEDIA_CONVERT_PRICE_HD_PER_MIN,

    DB: db as unknown as D1Database,
    video_subscription_db: db as unknown as D1Database,
    BUCKET: bucket as unknown as R2Bucket,
    RATE_LIMIT_KV: kv as unknown as KVNamespace,
    SEGMENT_RATE_LIMITER: new InMemoryDurableObjectNamespace(),
    CF_COLO: process.env.CF_COLO ?? 'DENO',
  }

  cachedEnv = env
  return env
}

export async function getEnv(): Promise<CFEnvShape> {
  if (cachedEnv) return cachedEnv
  if (envBuildPromise) return envBuildPromise
  envBuildPromise = buildEnv()
    .then((env) => {
      cachedEnv = env
      return env
    })
    .finally(() => {
      envBuildPromise = null
    })
  return envBuildPromise
}

export async function rebuildEnv(): Promise<CFEnvShape> {
  await cachedDb?.close()
  cachedKv?.stop()
  cachedEnv = null
  cachedDb = null
  cachedKv = null
  envBuildPromise = null
  return getEnv()
}

export function getDbAdapter(): PostgresD1Adapter | null {
  return cachedDb
}
