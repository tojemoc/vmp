import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SqliteD1Adapter } from './bindings/db.js'
import { S3R2Adapter } from './bindings/bucket.js'
import { SqliteKVAdapter } from './bindings/kv.js'
import { InMemoryDurableObjectNamespace } from './bindings/durableObject.js'
import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import type { CFEnvShape, NodeEnv } from './types.js'

const workspaceRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

let cachedEnv: CFEnvShape | null = null
let cachedDb: SqliteD1Adapter | null = null
let cachedKv: SqliteKVAdapter | null = null
let envBuildPromise: Promise<CFEnvShape> | null = null

export function migrationsDir(): string {
  return resolve(workspaceRoot, 'packages/api/migrations')
}

export async function buildEnv(): Promise<CFEnvShape> {
  const dbPath = process.env.SQLITE_DB_PATH ?? './data/vmp.sqlite'
  mkdirSync(dirname(resolve(dbPath)), { recursive: true })

  const db = new SqliteD1Adapter({
    dbPath,
    migrationsDir: migrationsDir(),
    enableWriteLog: true,
  })
  const kv = new SqliteKVAdapter(db)

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
    GOCARDLESS_WEBHOOK_SECRET: process.env.GOCARDLESS_WEBHOOK_SECRET,
    FRONTEND_URL: process.env.FRONTEND_URL,
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
    CF_COLO: 'FAILOVER',
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
  cachedDb?.close()
  cachedKv?.stop()
  cachedEnv = null
  cachedDb = null
  cachedKv = null
  envBuildPromise = null
  return getEnv()
}

export function getDbAdapter(): SqliteD1Adapter | null {
  return cachedDb
}

export function toNodeEnv(env: CFEnvShape): NodeEnv {
  return {
    ...env,
    SQLITE_DB_PATH: process.env.SQLITE_DB_PATH ?? './data/vmp.sqlite',
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
    CF_D1_DATABASE_ID: process.env.CF_D1_DATABASE_ID,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    AWS_REGION: process.env.AWS_REGION,
    D1_SYNC_INTERVAL_MS: process.env.D1_SYNC_INTERVAL_MS,
    D1_SYNC_STATE_PATH: process.env.D1_SYNC_STATE_PATH,
  }
}
