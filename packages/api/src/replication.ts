import { requireRole } from './auth.js'
import { getReplicationQueue } from './queueBindings.js'

type ReplicationDirection = 'd1_to_pg' | 'pg_to_d1'

const DEFAULT_DIRECTION: ReplicationDirection = 'd1_to_pg'
const DEFAULT_EPOCH = 1
const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500
const CURSOR_ROW_LIMIT = 1000
const REPLICATION_FETCH_TIMEOUT_MS = 10000
/** Cloudflare Queues sendBatch limit per call. */
const QUEUE_SEND_BATCH_MAX = 100
const STREAM_USERS = 'users'
const STREAM_SUBSCRIPTIONS = 'subscriptions'
const STREAM_VIDEOS = 'videos'
const STREAM_ADMIN_SETTINGS = 'admin_settings'
const STREAMS = [STREAM_USERS, STREAM_SUBSCRIPTIONS, STREAM_VIDEOS, STREAM_ADMIN_SETTINGS] as const

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

async function ensureReplicationStateTable(db: any) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS replication_sync_state (
      stream_name TEXT PRIMARY KEY,
      cursor_value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run()
}

async function getAdminSetting(db: any, key: string) {
  const row = await db.prepare('SELECT value FROM admin_settings WHERE key = ? LIMIT 1').bind(key).first()
  return row?.value ?? null
}

async function setAdminSetting(db: any, key: string, value: string) {
  await db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run()
}

function parseDirection(input: unknown): ReplicationDirection {
  const value = String(input ?? '').trim().toLowerCase()
  if (value === 'pg_to_d1') return 'pg_to_d1'
  return 'd1_to_pg'
}

function parseEpoch(input: unknown) {
  const value = Number.parseInt(String(input ?? ''), 10)
  if (!Number.isFinite(value) || value < 1) return DEFAULT_EPOCH
  return value
}

function parseBatchSize(input: unknown) {
  const value = Number.parseInt(String(input ?? ''), 10)
  if (!Number.isFinite(value) || value < 1) return DEFAULT_BATCH_SIZE
  return Math.min(value, MAX_BATCH_SIZE)
}

function rowCursor(updatedAt: unknown, id: unknown) {
  return `${String(updatedAt ?? '')}|${String(id ?? '')}`
}

function parseCursor(cursor: string) {
  if (!cursor) return { updatedAt: '', id: '' }
  const separator = cursor.indexOf('|')
  if (separator < 0) return { updatedAt: cursor, id: '' }
  return {
    updatedAt: cursor.slice(0, separator),
    id: cursor.slice(separator + 1),
  }
}

async function getStreamCursor(db: any, streamName: string) {
  const row = await db.prepare(`
    SELECT cursor_value FROM replication_sync_state
    WHERE stream_name = ?
    LIMIT 1
  `).bind(streamName).first()
  return String(row?.cursor_value ?? '')
}

async function setStreamCursor(db: any, streamName: string, cursorValue: string) {
  await db.prepare(`
    INSERT INTO replication_sync_state (stream_name, cursor_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(stream_name) DO UPDATE SET
      cursor_value = excluded.cursor_value,
      updated_at = CURRENT_TIMESTAMP
  `).bind(streamName, cursorValue).run()
}

async function sendReplicationMessages(
  queue: NonNullable<ReturnType<typeof getReplicationQueue>>,
  messages: unknown[],
) {
  const batch = messages.map((body) => ({ body }))
  for (let i = 0; i < batch.length; i += QUEUE_SEND_BATCH_MAX) {
    await queue.sendBatch(batch.slice(i, i + QUEUE_SEND_BATCH_MAX))
  }
}

function buildMessage(params: {
  epoch: number
  direction: ReplicationDirection
  stream: string
  row: Record<string, unknown>
  cursor: string
}) {
  const rowId = String(params.row.id ?? params.row.key ?? '')
  return {
    eventId: crypto.randomUUID(),
    op: 'upsert',
    stream: params.stream,
    streamCursor: params.cursor,
    rowId,
    direction: params.direction,
    epoch: params.epoch,
    source: 'cloudflare-d1',
    emittedAt: new Date().toISOString(),
    payload: params.row,
  }
}

async function enqueueStreamUsers(db: any, env: any, context: { direction: ReplicationDirection, epoch: number, batchSize: number }) {
  const stream = STREAM_USERS
  const cursor = await getStreamCursor(db, stream)
  const cursorParts = parseCursor(cursor)
  const rows = await db.prepare(`
    SELECT id, email, role, totp_enabled, created_at
    FROM users
    WHERE (? = '' OR datetime(created_at) > datetime(?) OR (datetime(created_at) = datetime(?) AND id > ?))
    ORDER BY datetime(created_at) ASC, id ASC
    LIMIT ?
  `).bind(cursor, cursorParts.updatedAt, cursorParts.updatedAt, cursorParts.id, CURSOR_ROW_LIMIT).all()
  const sorted = rows?.results ?? []
  if (!sorted.length) return 0
  const selected = sorted.slice(0, context.batchSize)
  const messages = selected.map((row: any) => buildMessage({
    epoch: context.epoch,
    direction: context.direction,
    stream,
    cursor: rowCursor(row.created_at, row.id),
    row: {
      id: row.id,
      email: row.email,
      role: row.role,
      totp_enabled: row.totp_enabled,
      created_at: row.created_at,
    },
  }))
  const queue = getReplicationQueue(env)
  if (!queue) throw new Error('Replication queue binding not found (vmp_replication_events)')
  await sendReplicationMessages(queue, messages)
  const last = selected[selected.length - 1]
  await setStreamCursor(db, stream, rowCursor(last.created_at, last.id))
  return selected.length
}

async function enqueueStreamSubscriptions(db: any, env: any, context: { direction: ReplicationDirection, epoch: number, batchSize: number }) {
  const stream = STREAM_SUBSCRIPTIONS
  const cursor = await getStreamCursor(db, stream)
  const cursorParts = parseCursor(cursor)
  const rows = await db.prepare(`
    SELECT id, user_id, plan_type, status, provider, provider_subscription_id, provider_customer_id,
           stripe_subscription_id, stripe_customer_id, current_period_end, created_at, updated_at
    FROM subscriptions
    WHERE (? = '' OR datetime(updated_at) > datetime(?) OR (datetime(updated_at) = datetime(?) AND id > ?))
    ORDER BY datetime(updated_at) ASC, id ASC
    LIMIT ?
  `).bind(cursor, cursorParts.updatedAt, cursorParts.updatedAt, cursorParts.id, CURSOR_ROW_LIMIT).all()
  const sorted = rows?.results ?? []
  if (!sorted.length) return 0
  const selected = sorted.slice(0, context.batchSize)
  const messages = selected.map((row: any) => buildMessage({
    epoch: context.epoch,
    direction: context.direction,
    stream,
    cursor: rowCursor(row.updated_at, row.id),
    row,
  }))
  const queue = getReplicationQueue(env)
  if (!queue) throw new Error('Replication queue binding not found (vmp_replication_events)')
  await sendReplicationMessages(queue, messages)
  const last = selected[selected.length - 1]
  await setStreamCursor(db, stream, rowCursor(last.updated_at, last.id))
  return selected.length
}

async function enqueueStreamVideos(db: any, env: any, context: { direction: ReplicationDirection, epoch: number, batchSize: number }) {
  const stream = STREAM_VIDEOS
  const cursor = await getStreamCursor(db, stream)
  const cursorParts = parseCursor(cursor)
  const rows = await db.prepare(`
    SELECT id, title, description, thumbnail_url, full_duration, preview_duration, upload_date,
           status, publish_status, published_at, updated_at, slug, scheduled_publish_at, notified_at
    FROM videos
    WHERE (? = '' OR datetime(updated_at) > datetime(?) OR (datetime(updated_at) = datetime(?) AND id > ?))
    ORDER BY datetime(updated_at) ASC, id ASC
    LIMIT ?
  `).bind(cursor, cursorParts.updatedAt, cursorParts.updatedAt, cursorParts.id, CURSOR_ROW_LIMIT).all()
  const sorted = rows?.results ?? []
  if (!sorted.length) return 0
  const selected = sorted.slice(0, context.batchSize)
  const messages = selected.map((row: any) => buildMessage({
    epoch: context.epoch,
    direction: context.direction,
    stream,
    cursor: rowCursor(row.updated_at, row.id),
    row,
  }))
  const queue = getReplicationQueue(env)
  if (!queue) throw new Error('Replication queue binding not found (vmp_replication_events)')
  await sendReplicationMessages(queue, messages)
  const last = selected[selected.length - 1]
  await setStreamCursor(db, stream, rowCursor(last.updated_at, last.id))
  return selected.length
}

async function enqueueStreamAdminSettings(db: any, env: any, context: { direction: ReplicationDirection, epoch: number, batchSize: number }) {
  const stream = STREAM_ADMIN_SETTINGS
  const cursor = await getStreamCursor(db, stream)
  const cursorParts = parseCursor(cursor)
  const rows = await db.prepare(`
    SELECT key, value, updated_at
    FROM admin_settings
    WHERE (? = '' OR datetime(updated_at) > datetime(?) OR (datetime(updated_at) = datetime(?) AND key > ?))
    ORDER BY datetime(updated_at) ASC, key ASC
    LIMIT ?
  `).bind(cursor, cursorParts.updatedAt, cursorParts.updatedAt, cursorParts.id, CURSOR_ROW_LIMIT).all()
  const sorted = rows?.results ?? []
  if (!sorted.length) return 0
  const selected = sorted.slice(0, context.batchSize)
  const messages = selected.map((row: any) => buildMessage({
    epoch: context.epoch,
    direction: context.direction,
    stream,
    cursor: rowCursor(row.updated_at, row.key),
    row: {
      key: row.key,
      value: row.value,
      updated_at: row.updated_at,
    },
  }))
  const queue = getReplicationQueue(env)
  if (!queue) throw new Error('Replication queue binding not found (vmp_replication_events)')
  await sendReplicationMessages(queue, messages)
  const last = selected[selected.length - 1]
  await setStreamCursor(db, stream, rowCursor(last.updated_at, last.key))
  return selected.length
}

export async function enqueueReplicationBatch(env: any) {
  if (!getReplicationQueue(env)) return { skipped: true, reason: 'queue_not_bound' }
  const db = getDb(env)
  await ensureReplicationStateTable(db)
  const direction = parseDirection(await getAdminSetting(db, 'replication_mode') ?? DEFAULT_DIRECTION)
  if (direction !== 'd1_to_pg') return { skipped: true, reason: 'mode_not_primary' }
  const epoch = parseEpoch(await getAdminSetting(db, 'replication_epoch'))
  const batchSize = parseBatchSize(await getAdminSetting(db, 'replication_batch_size'))
  const context = { direction, epoch, batchSize }
  const [users, subscriptions, videos, adminSettings] = await Promise.all([
    enqueueStreamUsers(db, env, context),
    enqueueStreamSubscriptions(db, env, context),
    enqueueStreamVideos(db, env, context),
    enqueueStreamAdminSettings(db, env, context),
  ])
  return {
    skipped: false,
    direction,
    epoch,
    batchSize,
    counts: { users, subscriptions, videos, adminSettings },
  }
}

export async function handleReplicationQueue(batch: any, env: any) {
  const targetUrl = String(env.REPLICATION_TARGET_URL ?? '').trim()
  if (!targetUrl) throw new Error('REPLICATION_TARGET_URL is not configured')
  const token = String(env.REPLICATION_TARGET_TOKEN ?? '').trim()
  const payload = {
    source: 'cloudflare-workers',
    events: batch.messages.map((message: any) => message.body),
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  let response: Response
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REPLICATION_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Replication target request timed out after ${REPLICATION_FETCH_TIMEOUT_MS}ms`)
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Replication target request aborted')
    }
    throw error
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Replication target rejected batch (${response.status}): ${body.slice(0, 300)}`)
  }
  for (const message of batch.messages) {
    message.ack()
  }
}

export async function handleAdminReplicationSettings(request: Request, env: any, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  const db = getDb(env)
  await ensureReplicationStateTable(db)
  if (request.method === 'GET') {
    const [modeRaw, epochRaw, batchSizeRaw, targetUrlRaw] = await Promise.all([
      getAdminSetting(db, 'replication_mode'),
      getAdminSetting(db, 'replication_epoch'),
      getAdminSetting(db, 'replication_batch_size'),
      Promise.resolve(String(env.REPLICATION_TARGET_URL ?? '').trim()),
    ])
    const cursorRows = await db.prepare(`
      SELECT stream_name, cursor_value, updated_at
      FROM replication_sync_state
      ORDER BY stream_name ASC
    `).all()
    return jsonResponse({
      mode: parseDirection(modeRaw ?? DEFAULT_DIRECTION),
      epoch: parseEpoch(epochRaw),
      batchSize: parseBatchSize(batchSizeRaw),
      targetConfigured: Boolean(targetUrlRaw),
      streams: cursorRows?.results ?? [],
    }, 200, corsHeaders)
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
  }

  if ('mode' in body) {
    const mode = parseDirection((body as any).mode)
    await setAdminSetting(db, 'replication_mode', mode)
  }
  if ('epoch' in body) {
    const epoch = parseEpoch((body as any).epoch)
    await setAdminSetting(db, 'replication_epoch', String(epoch))
  }
  if ('batchSize' in body) {
    const batchSize = parseBatchSize((body as any).batchSize)
    await setAdminSetting(db, 'replication_batch_size', String(batchSize))
  }
  if ((body as any).resetCursors === true) {
    await db.prepare('DELETE FROM replication_sync_state').run()
  } else if (Array.isArray((body as any).resetStreams)) {
    const streams = (body as any).resetStreams.map((value: unknown) => String(value)).filter((value: string) => STREAMS.includes(value as any))
    if (streams.length > 0) {
      const statement = db.prepare('DELETE FROM replication_sync_state WHERE stream_name = ?')
      await db.batch(streams.map((stream: string) => statement.bind(stream)))
    }
  }

  const [modeRaw, epochRaw, batchSizeRaw] = await Promise.all([
    getAdminSetting(db, 'replication_mode'),
    getAdminSetting(db, 'replication_epoch'),
    getAdminSetting(db, 'replication_batch_size'),
  ])
  const cursorRows = await db.prepare(`
    SELECT stream_name, cursor_value, updated_at
    FROM replication_sync_state
    ORDER BY stream_name ASC
  `).all()
  return jsonResponse({
    ok: true,
    mode: parseDirection(modeRaw ?? DEFAULT_DIRECTION),
    epoch: parseEpoch(epochRaw),
    batchSize: parseBatchSize(batchSizeRaw),
    streams: cursorRows?.results ?? [],
  }, 200, corsHeaders)
}
