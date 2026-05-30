import type { PostgresD1Adapter } from '../bindings/db.js'

export type ReplicationEvent = {
  eventId?: string
  op?: string
  stream?: string
  streamCursor?: string
  rowId?: string
  direction?: string
  epoch?: number
  source?: string
  emittedAt?: string
  payload?: Record<string, unknown>
}

export type ReplicationIngestResult = {
  applied: number
  skipped: number
  errors: { eventId?: string; stream?: string; error: string }[]
}

function ingestToken(): string {
  return String(
    process.env.REPLICATION_INGEST_TOKEN ?? process.env.REPLICATION_TARGET_TOKEN ?? '',
  ).trim()
}

export function isReplicationIngestConfigured(): boolean {
  return ingestToken().length > 0
}

export function verifyReplicationIngestAuth(request: Request): boolean {
  const token = ingestToken()
  if (!token) return false
  const header = request.headers.get('Authorization') ?? ''
  return header === `Bearer ${token}`
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function asBoolInt(value: unknown): number {
  if (value === true || value === 1 || value === '1') return 1
  return 0
}

async function upsertUser(db: PostgresD1Adapter, row: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO users (id, email, role, totp_enabled, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      role = excluded.role,
      totp_enabled = excluded.totp_enabled,
      created_at = excluded.created_at
  `).bind(
    row.id,
    row.email,
    row.role ?? 'viewer',
    asBoolInt(row.totp_enabled),
    row.created_at ?? new Date().toISOString(),
  ).run()
}

async function upsertSubscription(db: PostgresD1Adapter, row: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO subscriptions (
      id, user_id, plan_type, status, provider, provider_subscription_id, provider_customer_id,
      stripe_subscription_id, stripe_customer_id, current_period_end, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      plan_type = excluded.plan_type,
      status = excluded.status,
      provider = excluded.provider,
      provider_subscription_id = excluded.provider_subscription_id,
      provider_customer_id = excluded.provider_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      stripe_customer_id = excluded.stripe_customer_id,
      current_period_end = excluded.current_period_end,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).bind(
    row.id,
    row.user_id,
    row.plan_type,
    row.status,
    row.provider ?? 'stripe',
    row.provider_subscription_id ?? null,
    row.provider_customer_id ?? null,
    row.stripe_subscription_id ?? null,
    row.stripe_customer_id ?? null,
    row.current_period_end ?? null,
    row.created_at ?? new Date().toISOString(),
    row.updated_at ?? new Date().toISOString(),
  ).run()
}

async function upsertVideo(db: PostgresD1Adapter, row: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO videos (
      id, title, description, thumbnail_url, full_duration, preview_duration, upload_date,
      status, publish_status, published_at, updated_at, slug, scheduled_publish_at, notified_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      thumbnail_url = excluded.thumbnail_url,
      full_duration = excluded.full_duration,
      preview_duration = excluded.preview_duration,
      upload_date = excluded.upload_date,
      status = excluded.status,
      publish_status = excluded.publish_status,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at,
      slug = excluded.slug,
      scheduled_publish_at = excluded.scheduled_publish_at,
      notified_at = excluded.notified_at
  `).bind(
    row.id,
    row.title,
    row.description ?? null,
    row.thumbnail_url ?? null,
    asInt(row.full_duration),
    asInt(row.preview_duration),
    row.upload_date ?? null,
    row.status ?? 'processed',
    row.publish_status ?? 'draft',
    row.published_at ?? null,
    row.updated_at ?? new Date().toISOString(),
    row.slug ?? null,
    row.scheduled_publish_at ?? null,
    row.notified_at ?? null,
  ).run()
}

async function upsertAdminSetting(db: PostgresD1Adapter, row: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).bind(
    row.key,
    row.value ?? '',
    row.updated_at ?? new Date().toISOString(),
  ).run()
}

export async function applyReplicationEvents(
  db: PostgresD1Adapter,
  events: ReplicationEvent[],
): Promise<ReplicationIngestResult> {
  const result: ReplicationIngestResult = { applied: 0, skipped: 0, errors: [] }

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      result.skipped++
      continue
    }
    if (event.op && event.op !== 'upsert') {
      result.skipped++
      continue
    }
    if (event.direction && event.direction !== 'd1_to_pg') {
      result.skipped++
      continue
    }
    const payload = event.payload
    if (!payload || typeof payload !== 'object') {
      result.skipped++
      continue
    }

    try {
      switch (event.stream) {
        case 'users':
          await upsertUser(db, payload)
          break
        case 'subscriptions':
          await upsertSubscription(db, payload)
          break
        case 'videos':
          await upsertVideo(db, payload)
          break
        case 'admin_settings':
          await upsertAdminSetting(db, payload)
          break
        default:
          result.skipped++
          continue
      }
      result.applied++
    } catch (err) {
      result.errors.push({
        eventId: event.eventId,
        stream: event.stream,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
