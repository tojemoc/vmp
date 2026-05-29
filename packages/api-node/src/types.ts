import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'

/** Cloudflare Worker env shape used by @vmp/api handlers. */
export interface CFEnvShape {
  JWT_SECRET?: string
  BREVO_API_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_PUBLIC_KEY?: string
  RSS_SECRET?: string
  TOTP_ENCRYPTION_KEY?: string
  GOCARDLESS_ACCESS_TOKEN?: string
  GOCARDLESS_CREDITOR_ID?: string
  GOCARDLESS_WEBHOOK_SECRET?: string
  FRONTEND_URL?: string
  ALLOWED_ORIGINS?: string
  R2_BASE_URL?: string
  SENDER_EMAIL?: string
  SENDER_NAME?: string
  STRIPE_PUBLISHABLE_KEY?: string
  MEDIA_CONVERT_ENABLED?: string
  MEDIA_CONVERT_INPUT_PREFIX?: string
  MEDIA_CONVERT_OUTPUT_PREFIX?: string
  MEDIA_CONVERT_MAX_UPLOAD_MB?: string
  MEDIA_CONVERT_PRICE_HD_PER_MIN?: string

  DB?: D1Database
  video_subscription_db?: D1Database
  BUCKET?: R2Bucket
  RATE_LIMIT_KV?: KVNamespace
  SETTINGS_KV?: KVNamespace
  SEGMENT_RATE_LIMITER?: DurableObjectNamespaceStub
  CF_COLO?: string
}

export interface DurableObjectNamespaceStub {
  idFromName(name: string): DurableObjectIdStub
  get(id: DurableObjectIdStub): DurableObjectStub
}

export interface DurableObjectIdStub {
  toString(): string
}

export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface SyncResult {
  ok: boolean
  durationMs: number
  strategy: 'full-replace' | 'incremental'
  bookmark?: string | null
  rowCounts?: Record<string, number>
  error?: string
}
