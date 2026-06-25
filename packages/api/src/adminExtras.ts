import { requireAuth, requireRole } from './auth.js'
import { ensureAdminSettingsTable } from './adminSettingsTable.js'
import { getSetting, setSetting, setSettings, buildSettingsStatements } from './settingsStore.js'
import {
  evaluateRoleChange,
  evaluateSelfRoleChange,
  evaluateSubscriptionStatusChange,
  isValidRoleName,
} from './adminUserPolicy.js'
import { parseCsvUserRows } from './userImportCsv.js'
import { log } from './logger.js'

const PILLS_KEY_HASH_PREFIX = 'pbkdf2'
const PILLS_KEY_HASH_LEGACY_PREFIX = 'sha256'
const PILLS_KEY_HASH_PREVIOUS_PBKDF2_PREFIX = 'pbkdf2-sha256'
const PILLS_KEY_HASH_ITERATIONS = 120000

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function buildAdminAuditLogStatement(db: any, {
  actorUserId,
  actionType,
  targetUserId,
  detail
}: any) {
  return db.prepare(`
    INSERT INTO admin_audit_logs (id, actor_user_id, action_type, target_user_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    crypto.randomUUID(),
    actorUserId,
    actionType,
    targetUserId,
    JSON.stringify(detail ?? {}),
  )
}

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function isSafeHttpUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') return false
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function handleHomepageContent(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  try {
    const db = getDb(env)
    await ensureAdminSettingsTable(db)

    if (request.method === 'GET') {
      const [homepageRow, categoryRows] = await Promise.all([
        db.prepare('SELECT value FROM admin_settings WHERE key = ? LIMIT 1').bind('homepage').first(),
        db.prepare(`
          SELECT vc.id, vc.slug, vc.name, vc.sort_order, vc.direction, vc.homepage_layout_variant,
                 vc.recommendation_recency_bias, vc.recommendation_low_views_boost, vc.recommendation_category_lock,
                 COUNT(vca.video_id) AS video_count
          FROM video_categories vc
          LEFT JOIN video_category_assignments vca ON vca.category_id = vc.id
          GROUP BY vc.id
          ORDER BY
            CASE WHEN vc.sort_order <= 0 THEN 0 ELSE 1 END ASC,
            vc.sort_order ASC,
            vc.name ASC,
            vc.id ASC
        `).all(),
      ])
      const homepageConfig = normalizeHomepageConfigForResponse(safeJsonParse(homepageRow?.value, null))
      return jsonResponse({
        homepageConfig,
        categories: (categoryRows?.results ?? []).map((row: any) => ({
          ...row,
          priority_bucket: Number(row?.sort_order ?? 0) <= 0 ? 'p0' : 'standard',
        })),
        precedence: {
          summary: 'featured → uncategorized recent grid → category sections (P0 categories before standard categories).',
          categoryOrderRule: 'Categories with sort_order <= 0 are treated as P0 and rendered before all standard categories.',
          overflowRule: 'Categories with overflow remain in section order and expose remaining videos in overflow metadata.',
        },
      }, 200, corsHeaders)
    }
    if (request.method !== 'PATCH') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
    const body = await request.json().catch(() => null)
    const configUpdate = normalizeHomepageConfigForPatch(body?.homepageConfig)
    const categoryOrderUpdates = normalizeCategoryOrderUpdates(body?.categoryOrder)
    if (!configUpdate && !categoryOrderUpdates.length) {
      return jsonResponse({ error: 'Provide homepageConfig and/or categoryOrder updates.' }, 400, corsHeaders)
    }

    const writes = []
    if (configUpdate) {
      writes.push(['homepage', JSON.stringify(configUpdate)])
    }

    // Consolidate all writes into a single atomic batch operation for D1.
    // D1 does not support BEGIN/COMMIT via db.exec(); db.batch() provides atomicity.
    const allStatements = []
    if (categoryOrderUpdates.length) {
      const updateStmt = db.prepare(`UPDATE video_categories SET sort_order = ? WHERE id = ?`)
      const categoryStatements = categoryOrderUpdates.map((entry: any) => updateStmt.bind(entry.sortOrder, entry.id))
      allStatements.push(...categoryStatements)
    }
    if (writes.length) {
      const settingsStatements = buildSettingsStatements(env, writes)
      allStatements.push(...settingsStatements)
    }
    if (allStatements.length) {
      await db.batch(allStatements)
    }

    // Update KV cache for settings after D1 batch completes.
    if (writes.length) {
      const kv = env.SETTINGS_KV || env.RATE_LIMIT_KV || null
      if (kv) {
        for (const [key, value] of writes) {
          try {
            const normalized = value == null ? '' : String(value)
            const kvKey = `settings:${key}`
            await kv.put(kvKey, normalized, { expirationTtl: 300 })
          } catch {
            // D1 batch already committed; cache can self-heal on read.
          }
        }
      }
    }

    return jsonResponse({
      ok: true,
      updated: {
        homepageConfig: Boolean(configUpdate),
        categoryOrder: categoryOrderUpdates.length,
      },
    }, 200, corsHeaders)
  } catch (error) {
    console.error('handleHomepageContent:', error)
    return jsonResponse({ error: 'Internal server error', code: 'internal_error' }, 500, corsHeaders)
  }
}

function normalizeHomepageConfigForResponse(config: any) {
  const input = config && typeof config === 'object' ? config : {}
  const featuredVideoIds = Array.isArray(input.featuredVideoIds)
    ? input.featuredVideoIds.filter((id: any) => typeof id === 'string').slice(0, 4)
    : []
  const featuredMode = input.featuredMode === 'specific' ? 'specific' : 'latest'
  const featuredVideoId = typeof input.featuredVideoId === 'string' ? input.featuredVideoId : null
  const layoutBlocks = Array.isArray(input.layoutBlocks)
    ? input.layoutBlocks.filter((block: any) => block && typeof block === 'object').map((block: any) => {
      const type = normalizeLayoutBlockType(block.type)
      const normalized = {
        id: typeof block.id === 'string' ? block.id : crypto.randomUUID(),
        type,
        title: typeof block.title === 'string' ? block.title : '',
        body: typeof block.body === 'string' ? block.body : '',
      } as Record<string, any>
      const widthRaw = block.width
      if (type === 'page_banner') {
        normalized.width = 'full'
      } else if (widthRaw === 'half' || widthRaw === 'full') {
        normalized.width = widthRaw
      } else if (type === 'featured_row' || type === 'top_video') {
        normalized.width = 'full'
      } else if (type === 'category' || type === 'split_horizontal' || type === 'split_vertical') {
        normalized.width = 'half'
      }
      if (block.mobileHidden === true) normalized.mobileHidden = true
      if (Number.isFinite(Number(block.mobileOrder))) normalized.mobileOrder = Number(block.mobileOrder)
      if (Number.isFinite(Number(block.gridRow))) normalized.gridRow = Number(block.gridRow)
      if (Number.isFinite(Number(block.gridCol))) normalized.gridCol = Number(block.gridCol)
      if (type === 'category') {
        normalized.categoryId = typeof block.categoryId === 'string' ? block.categoryId : null
      }
      if (type === 'page_banner') {
        normalized.imageId = typeof block.imageId === 'string' ? block.imageId : ''
        normalized.mobileImageId = typeof block.mobileImageId === 'string' ? block.mobileImageId : ''
        normalized.pageSlug = typeof block.pageSlug === 'string' ? block.pageSlug : ''
        normalized.alt = typeof block.alt === 'string' ? block.alt : ''
      }
      if (type === 'split_horizontal' || type === 'split_vertical') {
        const children = Array.isArray(block.childBlocks) ? block.childBlocks : []
        normalized.childBlocks = children
          .filter((child: any) => child && typeof child === 'object')
          .map((child: any) => ({
            id: typeof child.id === 'string' ? child.id : crypto.randomUUID(),
            type: normalizeHomepageChildBlockType(child.type),
            title: typeof child.title === 'string' ? child.title : '',
            body: typeof child.body === 'string' ? child.body : '',
            categoryId: typeof child.categoryId === 'string' ? child.categoryId : null,
          }))
          .slice(0, 2)
      }
      return normalized
    })
    : []
  return {
    featuredVideoIds,
    featuredMode,
    featuredVideoId,
    layoutBlocks,
  }
}

function normalizeHomepageConfigForPatch(raw: any) {
  if (!raw || typeof raw !== 'object') return null
  return normalizeHomepageConfigForResponse(raw)
}

function normalizeLayoutBlockType(type: any) {
  if (type === 'featured') return 'featured_row'
  if (type === 'hero') return 'featured_row'
  if (type === 'video_grid') return 'category'
  if (type === 'text_split') return 'split_horizontal'
  if (type === 'cta') return 'top_video'
  const allowedTypes = new Set(['featured_row', 'category', 'top_video', 'split_horizontal', 'split_vertical', 'page_banner'])
  return allowedTypes.has(type) ? type : 'top_video'
}

function normalizeHomepageChildBlockType(type: any) {
  const allowedTypes = new Set(['featured_row', 'category', 'top_video'])
  return allowedTypes.has(type) ? type : 'top_video'
}

function normalizeCategoryOrderUpdates(raw: any) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const sortOrder = Number(entry.sortOrder)
    if (!id || !Number.isInteger(sortOrder)) continue
    out.push({ id, sortOrder })
  }
  return out
}

function safeJsonParse(v: any, fallback: any) {
  if (!v) return fallback
  try { return JSON.parse(v) } catch { return fallback }
}

export async function handleHomepageContentPublic(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }
  try {
    const db = getDb(env)
    await ensureAdminSettingsTable(db)
    const homepageRow = await db.prepare('SELECT value FROM admin_settings WHERE key = ? LIMIT 1').bind('homepage').first()
    const homepageConfig = normalizeHomepageConfigForResponse(safeJsonParse(homepageRow?.value, null))
    return jsonResponse({ homepageConfig }, 200, corsHeaders)
  } catch (error) {
    console.error('handleHomepageContentPublic:', error)
    return jsonResponse({ error: 'Internal server error', code: 'internal_error' }, 500, corsHeaders)
  }
}

export async function handlePillsPublic(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, label, value, color, image_url, sort_order, updated_at, value_mode, value_secondary, graph_embed_url, graph_payload_json
    FROM pills ORDER BY sort_order ASC, datetime(updated_at) DESC
  `).all()
  const pills = (rows?.results ?? []).map((row: any) => normalizePillRecord(row))
  return jsonResponse({ pills }, 200, corsHeaders)
}

export async function handlePillsUpdate(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const db = getDb(env)
  const preAuthRateLimit = await checkPillsUpdateRateLimit(request, env, { phase: 'ip' })
  if (preAuthRateLimit.error) {
    return jsonResponse({ error: preAuthRateLimit.error, code: 'invalid_config' }, 500, corsHeaders)
  }
  if (preAuthRateLimit.limited) {
    return new Response(JSON.stringify({
      error: 'Too many pills update requests',
      code: 'rate_limited',
    }, null, 2), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(preAuthRateLimit.retryAfterSeconds),
        ...corsHeaders,
      },
    })
  }

  const expectedHash = await getActivePillsApiKeyHash(env)
  const provided = request.headers.get('x-api-key') || ''
  const keyValid = expectedHash
    ? await verifyPillsApiKeyValue(provided, expectedHash)
    : false
  if (!keyValid) {
    return jsonResponse({ error: 'Unauthorized', code: 'invalid_api_key' }, 401, corsHeaders)
  }
  const keyFingerprint = getPillsKeyFingerprint(expectedHash)
  const postAuthRateLimit = await checkPillsUpdateRateLimit(request, env, { phase: 'key', keyFingerprint })
  if (postAuthRateLimit.error) {
    return jsonResponse({ error: postAuthRateLimit.error, code: 'invalid_config' }, 500, corsHeaders)
  }
  if (postAuthRateLimit.limited) {
    return new Response(JSON.stringify({
      error: 'Too many pills update requests',
      code: 'rate_limited',
    }, null, 2), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(postAuthRateLimit.retryAfterSeconds),
        ...corsHeaders,
      },
    })
  }
  const body = await request.json().catch(() => null)
  if (!Array.isArray(body?.pills)) return jsonResponse({ error: 'pills[] is required' }, 400, corsHeaders)
  const upsert = db.prepare(`
    INSERT INTO pills (id, label, value, color, image_url, sort_order, value_mode, value_secondary, graph_embed_url, graph_payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      value = excluded.value,
      color = excluded.color,
      image_url = excluded.image_url,
      sort_order = excluded.sort_order,
      value_mode = excluded.value_mode,
      value_secondary = excluded.value_secondary,
      graph_embed_url = excluded.graph_embed_url,
      graph_payload_json = excluded.graph_payload_json,
      updated_at = CURRENT_TIMESTAMP
  `)
  const nowPayload = JSON.stringify(body.pills).slice(0, 100000)
  await db.prepare(`
    INSERT INTO pills_updates_audit (id, source, payload_json, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(crypto.randomUUID(), request.headers.get('x-forwarded-for') || 'external-api', nowPayload).run()
  const statements = []
  for (let i = 0; i < body.pills.length; i += 1) {
    const pill = body.pills[i]
    if (!pill || typeof pill.id !== 'string' || typeof pill.label !== 'string') continue
    const normalized = normalizePillInput(pill, { allowImageUploadUrl: true })
    if (!normalized.ok) continue
    statements.push(upsert.bind(
      pill.id,
      normalized.value.label,
      normalized.value.value,
      normalized.value.color,
      normalized.value.imageUrl,
      Number.isInteger(pill.sortOrder) ? pill.sortOrder : i,
      normalized.value.valueMode,
      normalized.value.valueSecondary,
      normalized.value.graphEmbedUrl,
      normalized.value.graphPayloadJson,
    ))
  }
  if (statements.length) await db.batch(statements)
  return jsonResponse({ ok: true, updated: statements.length }, 200, corsHeaders)
}

interface PillsRateLimitOptions {
  phase?: 'ip' | 'key'
  keyFingerprint?: string
}

async function checkPillsUpdateRateLimit(request: any, env: any, options: PillsRateLimitOptions = {}) {
  const kv = env.RATE_LIMIT_KV || null
  if (!kv) return { limited: false, retryAfterSeconds: 0 }

  const configured = Number.parseInt(
    String((await getSetting(env, 'pills_update_rate_limit_per_minute')) ?? ''),
    10,
  )
  const perMinuteLimit = Number.isFinite(configured) && configured > 0 ? configured : null
  if (!perMinuteLimit) {
    return { limited: true, retryAfterSeconds: 60, error: 'pills_update_rate_limit_per_minute is not configured' }
  }
  const minute = Math.floor(Date.now() / 60000)
  const sourceIp = extractClientIp(request)
  const phase = options.phase === 'key' ? 'key' : 'ip'
  const keyFingerprint = typeof options.keyFingerprint === 'string' ? options.keyFingerprint : 'unknown'
  const rateKey = phase === 'ip'
    ? `pillsupd:${sourceIp}:${minute}`
    : `pillsupd:${sourceIp}:${keyFingerprint}:${minute}`
  const current = Number.parseInt((await kv.get(rateKey)) ?? '0', 10) || 0
  const next = current + 1
  await kv.put(rateKey, String(next), { expirationTtl: 75 })
  if (next > perMinuteLimit) return { limited: true, retryAfterSeconds: 60 }
  return { limited: false, retryAfterSeconds: 0 }
}

function extractClientIp(request: any) {
  const cf = request.headers.get('CF-Connecting-IP')
  if (cf && cf.trim()) return cf.trim()
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim()
  }
  return 'unknown'
}

export async function handleAdminPills(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  const db = getDb(env)

  if (request.method === 'GET') {
    const rows = await db.prepare(`
      SELECT id, label, value, color, image_url, sort_order, updated_at, value_mode, value_secondary, graph_embed_url, graph_payload_json
      FROM pills ORDER BY sort_order ASC, datetime(updated_at) DESC
    `).all()
    const pills = (rows?.results ?? []).map((row: any) => normalizePillRecord(row))
    return jsonResponse({ pills }, 200, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonResponse({ error: 'Request body is required' }, 400, corsHeaders)

  if (request.method === 'POST') {
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID()
    const normalized = normalizePillInput(body, { allowImageUploadUrl: false })
    if (!normalized.ok) return jsonResponse({ error: normalized.error }, 400, corsHeaders)
    const sortOrder = Number.isInteger(body.sortOrder) ? body.sortOrder : 0
    await db.prepare(`
      INSERT INTO pills (id, label, value, color, image_url, sort_order, value_mode, value_secondary, graph_embed_url, graph_payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      id,
      normalized.value.label,
      normalized.value.value,
      normalized.value.color,
      normalized.value.imageUrl,
      sortOrder,
      normalized.value.valueMode,
      normalized.value.valueSecondary,
      normalized.value.graphEmbedUrl,
      normalized.value.graphPayloadJson,
    ).run()
    return jsonResponse({ ok: true, id }, 201, corsHeaders)
  }

  if (request.method === 'PATCH') {
    if (Array.isArray(body.items)) {
      const reorderStatements = []
      for (let i = 0; i < body.items.length; i += 1) {
        const item = body.items[i]
        if (!item || typeof item.id !== 'string') continue
        reorderStatements.push(
          db.prepare(`UPDATE pills SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(i, item.id),
        )
      }
      if (reorderStatements.length) await db.batch(reorderStatements)
      return jsonResponse({ ok: true, updated: reorderStatements.length }, 200, corsHeaders)
    }
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) return jsonResponse({ error: 'id is required' }, 400, corsHeaders)
    const existing = await db.prepare(`
      SELECT value_mode, value_secondary, graph_embed_url, graph_payload_json
      FROM pills
      WHERE id = ?
      LIMIT 1
    `).bind(id).first()
    if (!existing) return jsonResponse({ error: 'Pill not found' }, 404, corsHeaders)
    const updates = []
    const values = []
    let nextMode = normalizePillMode(existing.value_mode) || 'number'
    let nextValueSecondary = existing.value_secondary == null ? null : Number(existing.value_secondary)
    let nextGraphEmbedUrl = typeof existing.graph_embed_url === 'string' ? existing.graph_embed_url : ''
    let nextGraphPayloadJson = typeof existing.graph_payload_json === 'string' ? existing.graph_payload_json : ''
    if (typeof body.label === 'string') {
      const next = body.label.trim()
      if (!next) return jsonResponse({ error: 'label must not be empty' }, 400, corsHeaders)
      updates.push('label = ?')
      values.push(next)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'value')) {
      const next = Number(body.value)
      if (!Number.isFinite(next)) return jsonResponse({ error: 'value must be a number' }, 400, corsHeaders)
      updates.push('value = ?')
      values.push(next)
    }
    if (typeof body.color === 'string') {
      const next = body.color.trim()
      if (!next) return jsonResponse({ error: 'color must not be empty' }, 400, corsHeaders)
      updates.push('color = ?')
      values.push(next)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'imageUrl')) {
      const next = body.imageUrl == null ? null : String(body.imageUrl).trim().slice(0, 2048)
      if (next && !validateAdminPillImageUrl(next).ok) {
        return jsonResponse({ error: 'Use image upload for pill images.' }, 400, corsHeaders)
      }
      updates.push('image_url = ?')
      values.push(next || null)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'valueMode')) {
      const mode = normalizePillMode(body.valueMode)
      if (!mode) return jsonResponse({ error: 'valueMode must be number, percentage, agree_disagree, or graph_embed' }, 400, corsHeaders)
      nextMode = mode
      updates.push('value_mode = ?')
      values.push(mode)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'valueSecondary')) {
      const next = body.valueSecondary == null || body.valueSecondary === '' ? null : Number(body.valueSecondary)
      if (next != null && !Number.isFinite(next)) return jsonResponse({ error: 'valueSecondary must be a number' }, 400, corsHeaders)
      nextValueSecondary = next
      updates.push('value_secondary = ?')
      values.push(next)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'graphEmbedUrl')) {
      const next = body.graphEmbedUrl == null ? null : String(body.graphEmbedUrl).trim().slice(0, 2048)
      if (next && !isSafeHttpUrl(next)) {
        return jsonResponse({ error: 'graphEmbedUrl must be a valid http or https URL' }, 400, corsHeaders)
      }
      nextGraphEmbedUrl = next || ''
      updates.push('graph_embed_url = ?')
      values.push(next || null)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'graphPayloadJson')) {
      const next = body.graphPayloadJson == null ? null : String(body.graphPayloadJson).trim().slice(0, 10000)
      if (next) {
        try {
          JSON.parse(next)
        } catch {
          return jsonResponse({ error: 'graphPayloadJson must be valid JSON' }, 400, corsHeaders)
        }
      }
      nextGraphPayloadJson = next || ''
      updates.push('graph_payload_json = ?')
      values.push(next || null)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
      if (!Number.isInteger(body.sortOrder)) return jsonResponse({ error: 'sortOrder must be an integer' }, 400, corsHeaders)
      updates.push('sort_order = ?')
      values.push(body.sortOrder)
    }
    if (!updates.length) return jsonResponse({ error: 'No fields to update' }, 400, corsHeaders)
    if (nextMode === 'agree_disagree' && (nextValueSecondary == null || !Number.isFinite(nextValueSecondary))) {
      return jsonResponse({ error: 'agree_disagree pills require valueSecondary' }, 400, corsHeaders)
    }
    if (nextMode === 'graph_embed' && !nextGraphEmbedUrl && !nextGraphPayloadJson) {
      return jsonResponse({ error: 'graph_embed pills require graphEmbedUrl or graphPayloadJson' }, 400, corsHeaders)
    }
    values.push(id)
    await db.prepare(`
      UPDATE pills
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(...values).run()
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  if (request.method === 'DELETE') {
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) return jsonResponse({ error: 'id is required' }, 400, corsHeaders)
    await db.prepare('DELETE FROM pills WHERE id = ?').bind(id).run()
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
}

function normalizePillMode(rawMode: any): 'number' | 'percentage' | 'agree_disagree' | 'graph_embed' | null {
  const next = String(rawMode ?? 'number').trim().toLowerCase()
  if (next === 'number' || next === 'percentage' || next === 'agree_disagree' || next === 'graph_embed') return next
  return null
}

function normalizePillRecord(row: any) {
  return {
    ...row,
    value_mode: normalizePillMode(row?.value_mode) || 'number',
    value_secondary: row?.value_secondary == null ? null : Number(row.value_secondary),
    graph_embed_url: typeof row?.graph_embed_url === 'string' ? row.graph_embed_url : null,
    graph_payload_json: typeof row?.graph_payload_json === 'string' ? row.graph_payload_json : null,
  }
}

function normalizePillInput(body: any, options: { allowImageUploadUrl: boolean }) {
  const label = typeof body?.label === 'string' ? body.label.trim() : ''
  if (!label) return { ok: false as const, error: 'label is required' }
  const value = Number(body?.value)
  if (!Number.isFinite(value)) return { ok: false as const, error: 'value must be a number' }
  const valueMode = normalizePillMode(body?.valueMode) || 'number'
  const valueSecondary = body?.valueSecondary == null || body.valueSecondary === '' ? null : Number(body.valueSecondary)
  if (valueSecondary != null && !Number.isFinite(valueSecondary)) return { ok: false as const, error: 'valueSecondary must be a number' }
  const graphEmbedUrl = typeof body?.graphEmbedUrl === 'string' ? body.graphEmbedUrl.trim().slice(0, 2048) : ''
  if (graphEmbedUrl && !isSafeHttpUrl(graphEmbedUrl)) {
    return { ok: false as const, error: 'graphEmbedUrl must be a valid http or https URL' }
  }
  const graphPayloadJson = typeof body?.graphPayloadJson === 'string' ? body.graphPayloadJson.trim().slice(0, 10000) : ''
  if (valueMode === 'agree_disagree' && valueSecondary == null) {
    return { ok: false as const, error: 'agree_disagree pills require valueSecondary' }
  }
  if (valueMode === 'graph_embed' && !graphEmbedUrl && !graphPayloadJson) {
    return { ok: false as const, error: 'graph_embed pills require graphEmbedUrl or graphPayloadJson' }
  }
  if (graphPayloadJson) {
    try {
      JSON.parse(graphPayloadJson)
    } catch {
      return { ok: false as const, error: 'graphPayloadJson must be valid JSON' }
    }
  }
  const imageUrlRaw = typeof body?.imageUrl === 'string' ? body.imageUrl.trim().slice(0, 2048) : ''
  const imageUrl = imageUrlRaw || null
  if (!options.allowImageUploadUrl && imageUrl) {
    const imageUrlValidation = validateAdminPillImageUrl(imageUrl)
    if (!imageUrlValidation.ok) return { ok: false as const, error: 'Use image upload for pill images.' }
  }
  return {
    ok: true as const,
    value: {
      label,
      value,
      color: typeof body?.color === 'string' && body.color.trim() ? body.color.trim() : '#2563eb',
      imageUrl,
      valueMode,
      valueSecondary,
      graphEmbedUrl: graphEmbedUrl || null,
      graphPayloadJson: graphPayloadJson || null,
    },
  }
}

function validateAdminPillImageUrl(imageUrl: string) {
  try {
    const url = new URL(imageUrl)
    if (url.protocol !== 'https:') return { ok: false as const }
    const encodedPath = url.pathname || ''
    const decodedPath = decodeURIComponent(encodedPath)
    if (!decodedPath.startsWith('/pills/')) return { ok: false as const }
    if (decodedPath.includes('..') || /%2e/i.test(encodedPath)) return { ok: false as const }
    return { ok: true as const }
  } catch {
    return { ok: false as const }
  }
}

export async function handleAdminPillImageUpload(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  if (!env.BUCKET) return jsonResponse({ error: 'R2 bucket not configured' }, 503, corsHeaders)
  const form = await request.formData().catch(() => null)
  const file = form?.get('image')
  if (!file || typeof file === 'string') return jsonResponse({ error: 'Missing image file' }, 400, corsHeaders)
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return jsonResponse({ error: 'Unsupported image type' }, 415, corsHeaders)
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > 5 * 1024 * 1024) return jsonResponse({ error: 'Image too large (max 5MB)' }, 413, corsHeaders)
  const ext = file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
      : file.type === 'image/gif' ? 'gif'
        : 'jpg'
  const base = String(env.R2_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (!base) {
    return jsonResponse({ error: 'R2_BASE_URL is not configured' }, 503, corsHeaders)
  }
  const key = `pills/${Date.now()}-${crypto.randomUUID()}.${ext}`
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: file.type } })
  const imageUrl = `${base}/${key}`
  return jsonResponse({ ok: true, imageUrl, key }, 200, corsHeaders)
}

export async function handleAdminPillsSettings(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  const envKey = typeof env.PILLS_API_KEY === 'string' ? env.PILLS_API_KEY.trim() : ''
  const activeHash = await getActivePillsApiKeyHash(env)
  const active = envKey || activeHash

  if (request.method === 'GET') {
    return jsonResponse({
      hasKey: Boolean(active),
      managedByEnv: Boolean(envKey),
      maskedKey: active ? buildMaskedKey(active) : '',
    }, 200, corsHeaders)
  }
  if (request.method !== 'PATCH') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  if (envKey) {
    return jsonResponse({ error: 'PILLS_API_KEY is managed by environment secret' }, 409, corsHeaders)
  }
  const body = await request.json().catch(() => null)
  const nextKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!nextKey) return jsonResponse({ error: 'apiKey is required' }, 400, corsHeaders)
  const nextHash = await hashPillsApiKey(nextKey)
  await setSetting(env, 'pills_api_key', nextHash)
  return jsonResponse({ ok: true, hasKey: true, maskedKey: buildMaskedKey(nextHash) }, 200, corsHeaders)
}

export async function handleCategoryVideosBySlug(request: any, env: any, corsHeaders: any) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const db = getDb(env)
  const url = new URL(request.url)
  let slug = ''
  try {
    slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-2) || '')
  } catch {
    return jsonResponse({ error: 'Invalid slug encoding', code: 'INVALID_SLUG' }, 400, corsHeaders)
  }
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '50', 10) || 50))
  const offset = (page - 1) * pageSize

  const category = await db.prepare(`
    SELECT id, slug, name, sort_order, direction
    FROM video_categories
    WHERE slug = ?
    LIMIT 1
  `).bind(slug).first()
  if (!category) return jsonResponse({ error: 'Category not found', code: 'category_not_found' }, 404, corsHeaders)

  const sortDirection = category.direction === 'asc' ? 'ASC' : 'DESC'
  const [rows, total] = await Promise.all([
    db.prepare(`
      SELECT v.id, v.title, v.description, v.thumbnail_url, v.full_duration, v.preview_duration, v.upload_date, v.publish_status, v.slug,
             vc.id AS category_id, vc.name AS category_name, vc.slug AS category_slug
      FROM videos v
      INNER JOIN video_category_assignments vca ON vca.video_id = v.id
      INNER JOIN video_categories vc ON vc.id = vca.category_id
      WHERE vc.slug = ? AND v.publish_status = 'published'
      ORDER BY datetime(v.upload_date) ${sortDirection}
      LIMIT ? OFFSET ?
    `).bind(slug, pageSize, offset).all(),
    db.prepare(`
      SELECT COUNT(*) AS total
      FROM videos v
      INNER JOIN video_category_assignments vca ON vca.video_id = v.id
      INNER JOIN video_categories vc ON vc.id = vca.category_id
      WHERE vc.slug = ? AND v.publish_status = 'published'
    `).bind(slug).first(),
  ])

  return jsonResponse({
    category,
    videos: rows?.results ?? [],
    pagination: {
      page,
      pageSize,
      total: Number(total?.total || 0),
      hasMore: page * pageSize < Number(total?.total || 0),
    },
  }, 200, corsHeaders)
}

export async function ensurePillsApiKeySetting(env: any) {
  const envKey = typeof env.PILLS_API_KEY === 'string' ? env.PILLS_API_KEY.trim() : ''
  if (!envKey) {
    await normalizeStoredPillsApiKeyHash(env)
    return
  }
  const stored = String((await getSetting(env, 'pills_api_key')) ?? '').trim()
  if (stored && await verifyPillsApiKeyValue(envKey, stored)) return
  const envHash = await hashPillsApiKey(envKey)
  await setSetting(env, 'pills_api_key', envHash)
}

async function getActivePillsApiKeyHash(env: any) {
  const envKey = typeof env.PILLS_API_KEY === 'string' ? env.PILLS_API_KEY.trim() : ''
  if (envKey) {
    const stored = String((await getSetting(env, 'pills_api_key')) ?? '').trim()
    if (stored && await verifyPillsApiKeyValue(envKey, stored)) return stored
    const envHash = await hashPillsApiKey(envKey)
    await setSetting(env, 'pills_api_key', envHash)
    return envHash
  }
  const normalizedStored = await normalizeStoredPillsApiKeyHash(env)
  return normalizedStored || ''
}

async function normalizeStoredPillsApiKeyHash(env: any) {
  const stored = (await getSetting(env, 'pills_api_key')) ?? ''
  const normalized = String(stored).trim()
  if (!normalized) return ''
  if (isHashedPillsApiKey(normalized)) return normalized
  const rehashed = await hashPillsApiKey(normalized)
  await setSetting(env, 'pills_api_key', rehashed)
  return rehashed
}

function isHashedPillsApiKey(value: any) {
  return typeof value === 'string'
    && (
      value.startsWith(`${PILLS_KEY_HASH_PREFIX}$`)
      || value.startsWith(`${PILLS_KEY_HASH_LEGACY_PREFIX}$`)
      || value.startsWith(`${PILLS_KEY_HASH_PREVIOUS_PBKDF2_PREFIX}$`)
    )
}

async function hashPillsApiKey(rawKey: any) {
  const normalized = typeof rawKey === 'string' ? rawKey.trim() : ''
  if (!normalized) return ''
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = new Uint8Array(await derivePbkdf2Sha256(normalized, salt, PILLS_KEY_HASH_ITERATIONS))
  return `${PILLS_KEY_HASH_PREFIX}$${PILLS_KEY_HASH_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`
}

export async function hashPillsApiKeyValue(rawKey: any) {
  return hashPillsApiKey(rawKey)
}

async function verifyPillsApiKeyValue(rawCandidate: any, storedHash: any) {
  const candidate = typeof rawCandidate === 'string' ? rawCandidate.trim() : ''
  if (!candidate || !storedHash) return false
  if (storedHash.startsWith(`${PILLS_KEY_HASH_PREFIX}$`)) {
    const parts = storedHash.split('$')
    if (parts.length !== 4) return false
    const iterations = Number.parseInt(parts[1], 10)
    if (!Number.isFinite(iterations) || iterations <= 0) return false
    const salt = base64ToBytes(parts[2])
    const expected = base64ToBytes(parts[3])
    const derived = new Uint8Array(await derivePbkdf2Sha256(candidate, salt, iterations))
    return timingSafeEqual(derived, expected)
  }
  if (storedHash.startsWith(`${PILLS_KEY_HASH_LEGACY_PREFIX}$`)) {
    const [, expectedHex] = storedHash.split('$')
    if (!expectedHex) return false
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate))
    const expected = bytesToHex(new Uint8Array(digest))
    return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(expectedHex))
  }
  if (!storedHash.startsWith(`${PILLS_KEY_HASH_PREVIOUS_PBKDF2_PREFIX}$`)) return false
  const parts = storedHash.split('$')
  if (parts.length !== 4) return false
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = hexToBytes(parts[2])
  const expected = hexToBytes(parts[3])
  const derived = new Uint8Array(await derivePbkdf2Sha256(candidate, salt, iterations))
  return timingSafeEqual(derived, expected)
}

function bytesToBase64(bytes: Uint8Array) {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str)
}

function base64ToBytes(value: string) {
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

async function derivePbkdf2Sha256(value: any, saltBytes: any, iterations: any) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    keyMaterial,
    256,
  )
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: any) {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array(0)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function timingSafeEqual(a: any, b: any) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= (a[i]! ^ b[i]!)
  return mismatch === 0
}

function getPillsKeyFingerprint(keyHash: any) {
  if (!keyHash || typeof keyHash !== 'string') return 'unknown'
  return keyHash.slice(-12)
}

function buildMaskedKey(keyValue: any) {
  const suffix = keyValue.slice(-4)
  return `••••••••${suffix}`
}

function parseUsersListQuery(url: any) {
  const q = url.searchParams
  const page = Math.min(500, Math.max(1, Number.parseInt(q.get('page') || '1', 10) || 1))
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.get('pageSize') || '25', 10) || 25))
  const search = typeof q.get('search') === 'string' ? q.get('search').trim().slice(0, 200) : ''
  const role = typeof q.get('role') === 'string' ? q.get('role').trim() : ''
  const subscription = typeof q.get('subscription') === 'string' ? q.get('subscription').trim().toLowerCase() : 'all'
  return { page, pageSize, search, role, subscription }
}

function usersListWhereClause({
  search,
  role,
  subscription
}: any) {
  const clauses = ['1=1']
  const binds = []
  if (search) {
    const sanitized = search.replace(/%/g, '').replace(/_/g, '').trim()
    if (sanitized) {
      const emailPrefix = `${sanitized}%`
      const idPrefix = `${sanitized}%`
      clauses.push('(u.email LIKE ? OR u.id LIKE ?)')
      binds.push(emailPrefix, idPrefix)
    }
  }
  if (role && role !== 'all') {
    clauses.push('u.role = ?')
    binds.push(role)
  }
  if (subscription && subscription !== 'all') {
    if (subscription === 'none') {
      clauses.push('s.id IS NULL')
    } else {
      clauses.push('s.status = ?')
      binds.push(subscription)
    }
  }
  return { sql: clauses.join(' AND '), binds }
}

export async function handleAdminUsers(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  const db = getDb(env)
  if (request.method === 'GET') {
    const url = new URL(request.url)
    const { page, pageSize, search, role, subscription } = parseUsersListQuery(url)
    const { sql: whereSql, binds: whereBinds } = usersListWhereClause({ search, role, subscription })
    const offset = (page - 1) * pageSize
    const fromSql = `
      FROM users u
      LEFT JOIN subscriptions s ON s.id = (
        SELECT id FROM subscriptions
        WHERE user_id = u.id
        ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, datetime(created_at) DESC
        LIMIT 1
      )
      WHERE ${whereSql}
    `
    const countStmt = db.prepare(`SELECT COUNT(*) AS n ${fromSql}`)
    const listStmt = db.prepare(`
      SELECT
        u.id, u.email, u.role, u.created_at,
        s.plan_type, s.status AS subscription_status, s.current_period_end
      ${fromSql}
      ORDER BY datetime(u.created_at) DESC
      LIMIT ? OFFSET ?
    `)
    const countRow = await countStmt.bind(...whereBinds).first()
    const total = Number(countRow?.n || 0)
    const rows = await listStmt.bind(...whereBinds, pageSize, offset).all()
    return jsonResponse({
      users: rows?.results ?? [],
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }, 200, corsHeaders)
  }
  if (request.method !== 'PATCH') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  let actor
  try {
    actor = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  const body = await request.json().catch(() => null)
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!userId) return jsonResponse({ error: 'userId is required' }, 400, corsHeaders)
  const target = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(userId).first()
  if (!target) return jsonResponse({ error: 'User not found', code: 'not_found' }, 404, corsHeaders)
  if (typeof actor.sub !== 'string' || !actor.sub) {
    return jsonResponse({ error: 'Invalid session', code: 'invalid_token' }, 401, corsHeaders)
  }
  const actorUserId = actor.sub
  const actorRole = typeof actor.role === 'string' ? actor.role : 'viewer'

  const wantsRole = typeof body?.role === 'string'
  const wantsSubscription = typeof body?.subscriptionStatus === 'string' || (body?.createSubscription && typeof body.createSubscription === 'object')
  if (wantsRole && wantsSubscription) {
    return jsonResponse({
      error: 'Send only one of role or subscriptionStatus per request',
      code: 'single_field_patch',
    }, 400, corsHeaders)
  }

  const latest = wantsSubscription
    ? await db.prepare(`
      SELECT id, status FROM subscriptions
      WHERE user_id = ?
      ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, datetime(created_at) DESC
      LIMIT 1
    `).bind(userId).first()
    : null

  if (wantsRole) {
    const newRole = body.role
    const matrix = evaluateRoleChange({
      actorRole,
      targetCurrentRole: target.role,
      newRole,
    })
    if (!matrix.ok) {
      const status = matrix.code === 'invalid_role' ? 400 : 403
      return jsonResponse({ error: matrix.error, code: matrix.code }, status, corsHeaders)
    }
    const selfCheck = evaluateSelfRoleChange({
      actorUserId,
      targetUserId: userId,
      actorRole,
      newRole,
    })
    if (!selfCheck.ok) {
      return jsonResponse({ error: selfCheck.error, code: selfCheck.code }, 403, corsHeaders)
    }
    if (!isValidRoleName(newRole)) {
      return jsonResponse({ error: 'Invalid role', code: 'invalid_role' }, 400, corsHeaders)
    }
    if (newRole === target.role) {
      return jsonResponse({ ok: true }, 200, corsHeaders)
    }
    const statements = [
      db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(newRole, userId),
      buildAdminAuditLogStatement(db, {
        actorUserId,
        actionType: 'user_role_change',
        targetUserId: userId,
        detail: { from: target.role, to: newRole },
      }),
    ]
    try {
      await db.batch(statements)
    } catch (e) {
      console.error('handleAdminUsers batch (role):', e)
      return jsonResponse({ error: 'Update failed', code: 'transaction_failed' }, 500, corsHeaders)
    }
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  if (wantsSubscription) {
    if (actorRole === 'admin' && target.role === 'super_admin') {
      return jsonResponse({ error: 'Only super_admin may edit super_admin accounts', code: 'forbidden_target' }, 403, corsHeaders)
    }
    const prevStatus = latest?.status ?? null
    const statusRaw = typeof body?.subscriptionStatus === 'string'
      ? body.subscriptionStatus
      : (typeof body?.createSubscription?.status === 'string' ? body.createSubscription.status : '')
    const transition = evaluateSubscriptionStatusChange(prevStatus, statusRaw)
    if (!transition.ok) {
      return jsonResponse({ error: transition.error, code: transition.code }, 400, corsHeaders)
    }
    const prevNormalized = prevStatus == null || prevStatus === '' ? 'none' : prevStatus
    const nextPersisted = transition.next === 'none' ? 'cancelled' : transition.next
    if (nextPersisted === prevNormalized) {
      return jsonResponse({ ok: true }, 200, corsHeaders)
    }
    if (transition.next === 'none') {
      if (!latest?.id) {
        return jsonResponse({ error: 'User has no subscription to cancel', code: 'no_subscription' }, 400, corsHeaders)
      }
      const statements = [
        db.prepare(`
          UPDATE subscriptions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(latest.id),
        buildAdminAuditLogStatement(db, {
          actorUserId,
          actionType: 'subscription_status_change',
          targetUserId: userId,
          detail: { from: prevStatus ?? 'none', to: 'cancelled' },
        }),
      ]
      try {
        await db.batch(statements)
      } catch (e) {
        console.error('handleAdminUsers batch (subscription cancel):', e)
        return jsonResponse({ error: 'Update failed', code: 'transaction_failed' }, 500, corsHeaders)
      }
      return jsonResponse({ ok: true }, 200, corsHeaders)
    }
    if (!latest?.id) {
      const createSub = body?.createSubscription
      const planTypeRaw = typeof createSub?.planType === 'string'
        ? createSub.planType
        : (typeof body?.planType === 'string' ? body.planType : 'monthly')
      const planType = planTypeRaw === 'yearly' || planTypeRaw === 'club' ? planTypeRaw : 'monthly'
      const newSubId = crypto.randomUUID()
      const statements = [
        db.prepare(`
          INSERT INTO subscriptions (id, user_id, plan_type, status, provider, updated_at, created_at)
          VALUES (?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(newSubId, userId, planType, transition.next),
        buildAdminAuditLogStatement(db, {
          actorUserId,
          actionType: 'subscription_manual_create',
          targetUserId: userId,
          detail: { status: transition.next, planType, provider: 'manual' },
        }),
      ]
      try {
        await db.batch(statements)
      } catch (e) {
        console.error('handleAdminUsers batch (subscription create):', e)
        return jsonResponse({ error: 'Update failed', code: 'transaction_failed' }, 500, corsHeaders)
      }
      return jsonResponse({ ok: true }, 200, corsHeaders)
    }
    const statements = [
      db.prepare(`
        UPDATE subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(transition.next, latest.id),
      buildAdminAuditLogStatement(db, {
        actorUserId,
        actionType: 'subscription_status_change',
        targetUserId: userId,
        detail: { from: prevStatus ?? 'none', to: transition.next },
      }),
    ]
    try {
      await db.batch(statements)
    } catch (e) {
      console.error('handleAdminUsers batch (subscription):', e)
      return jsonResponse({ error: 'Update failed', code: 'transaction_failed' }, 500, corsHeaders)
    }
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'role or subscriptionStatus is required' }, 400, corsHeaders)
}

export async function handleAdminUserImportCsv(request: any, env: any, corsHeaders: any) {
  let actor
  try {
    actor = await requireAuth(request, env)
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const db = getDb(env)
  const body = await request.json().catch(() => null)
  const csv = typeof body?.csv === 'string' ? body.csv : ''
  const mailingListId = typeof body?.mailingListId === 'string' ? body.mailingListId.trim() : ''
  const requirePurchaseId = body?.requirePurchaseId === true
  if (!csv.trim()) return jsonResponse({ error: 'csv is required' }, 400, corsHeaders)
  if (!mailingListId) return jsonResponse({ error: 'mailingListId is required' }, 400, corsHeaders)

  const [rawMaxEmails, rawImportPlan] = await Promise.all([
    getSetting(env, 'import_csv_max_emails'),
    getSetting(env, 'import_subscription_plan'),
  ])
  const configuredMaxEmails = Number.parseInt(String(rawMaxEmails ?? '').trim(), 10)
  const maxEmails = Number.isFinite(configuredMaxEmails) && configuredMaxEmails > 0
    ? configuredMaxEmails
    : 10000
  const importPlan = typeof rawImportPlan === 'string' && rawImportPlan.trim()
    ? rawImportPlan.trim()
    : 'monthly'

  const rows = parseCsvUserRows(csv, maxEmails)
  if (!rows.length) {
    return jsonResponse({ error: 'No valid emails found in csv payload' }, 400, corsHeaders)
  }
  if (requirePurchaseId && rows.some((row) => !row.purchaseId)) {
    return jsonResponse({
      error: 'Every CSV row must include a purchaseId (or clientId) when requirePurchaseId is enabled',
      code: 'missing_purchase_id',
    }, 400, corsHeaders)
  }

  const purchaseIds = rows.map((row) => row.purchaseId).filter((value): value is string => Boolean(value))
  const duplicatePurchaseIds = purchaseIds.filter((id, index) => purchaseIds.indexOf(id) !== index)
  if (duplicatePurchaseIds.length) {
    return jsonResponse({
      error: `Duplicate purchase IDs in CSV: ${[...new Set(duplicatePurchaseIds)].slice(0, 5).join(', ')}`,
      code: 'duplicate_purchase_id',
    }, 400, corsHeaders)
  }

  const nowIso = new Date().toISOString()
  const actorUserId = typeof actor?.sub === 'string' ? actor.sub : 'system'

  // Bulk lookup existing users
  const emailsArray = rows.map((row) => row.email)
  const existingUsersMap = new Map<string, string>()

  // Split emailsArray into chunks of 90 to avoid D1's 100-parameter limit
  const EMAIL_CHUNK_SIZE = 90
  for (let i = 0; i < emailsArray.length; i += EMAIL_CHUNK_SIZE) {
    const chunk = emailsArray.slice(i, i + EMAIL_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const existingUsersRows = await db.prepare(`
      SELECT id, lower(email) AS email_lower FROM users WHERE lower(email) IN (${placeholders})
    `).bind(...chunk).all()

    for (const row of (existingUsersRows?.results ?? [])) {
      existingUsersMap.set(String(row.email_lower), String(row.id))
    }
  }

  const usersUpsert = db.prepare(`
    INSERT INTO users (id, email, role, created_at)
    VALUES (?, ?, 'viewer', CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO NOTHING
  `)
  // needs_relink is a custom status used by this feature to indicate imported users
  // that need to be matched/linked to an external mailing list provider.
  // See settings users_relink_mailing_list_id and users_relink_imported_at.
  const subUpsert = db.prepare(`
    INSERT INTO subscriptions (
      id, user_id, plan_type, status, provider, stripe_subscription_id, stripe_customer_id,
      purchase_id, current_period_end, created_at, updated_at
    )
    VALUES (?, ?, ?, 'needs_relink', 'stripe', NULL, ?, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO NOTHING
  `)
  const subUpsertLegacy = db.prepare(`
    INSERT INTO subscriptions (
      id, user_id, plan_type, status, provider, stripe_subscription_id, stripe_customer_id,
      purchase_id, current_period_end, created_at, updated_at
    )
    VALUES (?, ?, ?, 'needs_relink', 'legacy', NULL, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      purchase_id = excluded.purchase_id,
      status = excluded.status,
      plan_type = excluded.plan_type,
      updated_at = CURRENT_TIMESTAMP
  `)

  let imported = 0
  let existing = 0
  let withPurchaseId = 0
  const statements = []
  for (const row of rows) {
    const email = row.email
    let userId = existingUsersMap.get(email)
    if (!userId) {
      userId = crypto.randomUUID()
      statements.push(usersUpsert.bind(userId, email))
      imported += 1
    } else {
      existing += 1
    }
    const subscriptionId = `import-${mailingListId}-${userId}`
    const importCustomerRef = `import-list:${mailingListId}`
    if (row.purchaseId) {
      withPurchaseId += 1
      statements.push(subUpsertLegacy.bind(
        subscriptionId,
        userId,
        importPlan,
        importCustomerRef,
        row.purchaseId,
      ))
    } else {
      statements.push(subUpsert.bind(subscriptionId, userId, importPlan, importCustomerRef))
    }
  }

  statements.push(buildAdminAuditLogStatement(db, {
    actorUserId,
    actionType: 'user_import_csv',
    targetUserId: null,
    detail: { mailingListId, imported, existing, withPurchaseId, totalEmails: rows.length, requirePurchaseId },
  }))

  // Execute statements in chunks to avoid D1 batch size and parameter limits
  const BATCH_CHUNK_SIZE = 250
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE)
    if (chunk.length) await db.batch(chunk)
  }

  await setSetting(env, 'users_relink_mailing_list_id', mailingListId)
  await setSetting(env, 'users_relink_imported_at', nowIso)

  return jsonResponse({
    ok: true,
    mailingListId,
    imported,
    existing,
    totalEmails: rows.length,
    withPurchaseId,
    requirePurchaseId,
    requiresRelinkStatus: 'needs_relink',
  }, 200, corsHeaders)
}

export async function handleAdminAnalytics(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method === 'PATCH') {
    const body = await request.json().catch(() => null)
    const viewCounting = body?.viewCounting && typeof body.viewCounting === 'object' ? body.viewCounting : null
    const toIntString = (value: any, fallback: number) => {
      const next = Number.parseInt(String(value ?? ''), 10)
      return String(Number.isFinite(next) && next >= 0 ? next : fallback)
    }
    const updates: [string, string][] = []
    if (viewCounting && Object.prototype.hasOwnProperty.call(viewCounting, 'minSegmentsPerSession')) {
      updates.push(['analytics_view_min_segments', toIntString(viewCounting.minSegmentsPerSession, 1)])
    }
    if (viewCounting && Object.prototype.hasOwnProperty.call(viewCounting, 'minWatchSeconds')) {
      updates.push(['analytics_view_min_watch_seconds', toIntString(viewCounting.minWatchSeconds, 15)])
    }
    if (updates.length) await setSettings(env, updates)
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const url = new URL(request.url)
  const parsed = parseAnalyticsQuery(url)
  if (parsed.error) {
    return jsonResponse({ error: parsed.error, code: 'invalid_query' }, 400, corsHeaders)
  }
  const db = getDb(env)
  const analytics = await buildSegmentAnalyticsSnapshotWithOptions(db, env, parsed.options)
  const settingKeys = [
    'analytics_view_min_segments',
    'analytics_view_min_watch_seconds',
  ] as const
  const settingValues = await Promise.all(settingKeys.map((key) => getSetting(env, key)))
  const getVal = (key: (typeof settingKeys)[number]) => settingValues[settingKeys.indexOf(key)]
  ;(analytics as any).viewCounting = {
    minSegmentsPerSession: parseNonNegativeInt(getVal('analytics_view_min_segments'), 1),
    minWatchSeconds: parseNonNegativeInt(getVal('analytics_view_min_watch_seconds'), 15),
  }
  if (parsed.options.format === 'csv') {
    const csv = buildAnalyticsCsvExport(analytics, parsed.options.dataset)
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="analytics-${parsed.options.dataset}-${Date.now()}.csv"`,
        ...corsHeaders,
      },
    })
  }
  return jsonResponse(analytics, 200, corsHeaders)
}

function canonicalSessionExpression() {
  return `
    COALESCE(
      session_key,
      CASE
        WHEN user_id IS NOT NULL THEN 'u:' || user_id
        WHEN ip_hash IS NOT NULL THEN 'i:' || ip_hash
        ELSE 'path:' || request_path
      END
    )
  `
}

export async function buildSegmentAnalyticsSnapshot(db: any) {
  return buildSegmentAnalyticsSnapshotWithOptions(db, null, {
    range: '30d',
    granularity: 'day',
    dataset: 'all',
    format: 'json',
    videoId: null,
  })
}

type AnalyticsRange = '7d' | '30d' | '90d' | '180d' | '365d'
type AnalyticsGranularity = 'hour' | 'day' | 'week' | 'month'
type AnalyticsDataset = 'all' | 'overview' | 'views' | 'watchtime' | 'retention' | 'sources' | 'countries' | 'subscriptions' | 'cashflow'
type AnalyticsFormat = 'json' | 'csv'

interface AnalyticsQueryOptions {
  range: AnalyticsRange
  granularity: AnalyticsGranularity
  dataset: AnalyticsDataset
  format: AnalyticsFormat
  videoId: string | null
}

function parseAnalyticsQuery(url: URL): { options: AnalyticsQueryOptions, error?: string } {
  const range = (url.searchParams.get('range') || '30d') as AnalyticsRange
  const granularity = (url.searchParams.get('granularity') || 'day') as AnalyticsGranularity
  const dataset = (url.searchParams.get('dataset') || 'all') as AnalyticsDataset
  const format = (url.searchParams.get('format') || 'json') as AnalyticsFormat
  const videoIdRaw = url.searchParams.get('videoId')
  const videoId = typeof videoIdRaw === 'string' && videoIdRaw.trim() ? videoIdRaw.trim() : null

  const ranges: AnalyticsRange[] = ['7d', '30d', '90d', '180d', '365d']
  const granularities: AnalyticsGranularity[] = ['hour', 'day', 'week', 'month']
  const datasets: AnalyticsDataset[] = ['all', 'overview', 'views', 'watchtime', 'retention', 'sources', 'countries', 'subscriptions', 'cashflow']
  const formats: AnalyticsFormat[] = ['json', 'csv']

  if (!ranges.includes(range)) return { options: fallbackAnalyticsOptions(), error: 'range must be one of 7d, 30d, 90d, 180d, 365d' }
  if (!granularities.includes(granularity)) return { options: fallbackAnalyticsOptions(), error: 'granularity must be one of hour, day, week, month' }
  if (!datasets.includes(dataset)) return { options: fallbackAnalyticsOptions(), error: 'dataset must be one of all, overview, views, watchtime, retention, sources, countries, subscriptions, cashflow' }
  if (!formats.includes(format)) return { options: fallbackAnalyticsOptions(), error: 'format must be json or csv' }
  if (format === 'csv' && dataset === 'all') {
    return { options: fallbackAnalyticsOptions(), error: 'dataset must be specified when format=csv' }
  }
  return { options: { range, granularity, dataset, format, videoId } }
}

function fallbackAnalyticsOptions(): AnalyticsQueryOptions {
  return {
    range: '30d',
    granularity: 'day',
    dataset: 'all',
    format: 'json',
    videoId: null,
  }
}

function daysForRange(range: AnalyticsRange) {
  if (range === '7d') return 7
  if (range === '90d') return 90
  if (range === '180d') return 180
  if (range === '365d') return 365
  return 30
}

function bucketExpr(column: string, granularity: AnalyticsGranularity) {
  if (granularity === 'hour') return `strftime('%Y-%m-%d %H:00', datetime(${column}))`
  if (granularity === 'week') return `strftime('%Y-W%W', datetime(${column}))`
  if (granularity === 'month') return `strftime('%Y-%m', datetime(${column}))`
  return `date(datetime(${column}))`
}

const INVALID_COUNTRY_CODES = new Set(['', 'XX', 'T1'])

export function normalizeCountryCode(raw: unknown) {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || INVALID_COUNTRY_CODES.has(code)) return null
  return code
}

export function computeEngagementScore(averageRetentionPercent: number | null, completionRatePercent: number | null) {
  if (averageRetentionPercent == null) return null
  const retention = Math.max(0, Math.min(100, averageRetentionPercent))
  const completion = completionRatePercent == null ? 0 : Math.max(0, Math.min(100, completionRatePercent))
  return Math.round(Math.min(100, retention * 0.75 + completion * 0.25))
}

function formatWatchSeconds(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

function buildHeatmapSeries(rows: Array<{ bucket_pct: number, watch_seconds: number, segment_hits: number }>, bucketCount = 100) {
  const byBucket = new Map<number, { watchSeconds: number, segmentHits: number }>()
  for (const row of rows) {
    const bucket = Number(row.bucket_pct)
    if (!Number.isFinite(bucket) || bucket < 0 || bucket >= bucketCount) continue
    const current = byBucket.get(bucket) || { watchSeconds: 0, segmentHits: 0 }
    current.watchSeconds += Number(row.watch_seconds || 0)
    current.segmentHits += Number(row.segment_hits || 0)
    byBucket.set(bucket, current)
  }
  return Array.from({ length: bucketCount }, (_, bucketPct) => {
    const entry = byBucket.get(bucketPct)
    return {
      positionPercent: bucketPct,
      watchSeconds: Number((entry?.watchSeconds ?? 0).toFixed(2)),
      segmentHits: entry?.segmentHits ?? 0,
    }
  })
}

function parseNumericSetting(raw: unknown, fallbackValue: number) {
  const next = Number(raw)
  return Number.isFinite(next) && next >= 0 ? next : fallbackValue
}

function parseNonNegativeInt(raw: unknown, fallbackValue: number) {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallbackValue
  return Math.max(0, parsed)
}

function sessionRetentionCte(sessionExpr: string) {
  return `
    WITH events AS (
      SELECT
        e.video_id AS video_id,
        ${sessionExpr} AS session_id,
        CASE
          WHEN e.playback_position_seconds IS NOT NULL THEN e.playback_position_seconds
          WHEN e.segment_index IS NOT NULL AND e.segment_duration_seconds IS NOT NULL THEN e.segment_index * e.segment_duration_seconds
          WHEN e.position_seconds IS NOT NULL THEN e.position_seconds
          ELSE NULL
        END AS playback_seconds
      FROM video_segment_events e
      WHERE e.event_type = 'segment'
        AND datetime(e.created_at) >= datetime(?)
    ),
    session_rollup AS (
      SELECT
        ev.video_id AS video_id,
        ev.session_id AS session_id,
        v.full_duration AS full_duration,
        COUNT(*) AS segment_hits,
        MAX(CASE
          WHEN v.full_duration IS NULL OR v.full_duration <= 0 OR ev.playback_seconds IS NULL THEN NULL
          WHEN ev.playback_seconds < 0 THEN 0
          WHEN ev.playback_seconds > v.full_duration THEN v.full_duration
          ELSE ev.playback_seconds
        END) AS max_bounded_seconds
      FROM events ev
      LEFT JOIN videos v ON v.id = ev.video_id
      WHERE ev.session_id IS NOT NULL
      GROUP BY ev.video_id, ev.session_id, v.full_duration
    ),
    qualified AS (
      SELECT
        video_id,
        session_id,
        CASE
          WHEN full_duration IS NULL OR full_duration <= 0 OR max_bounded_seconds IS NULL THEN NULL
          ELSE MIN(100.0, MAX(0.0, (max_bounded_seconds * 100.0) / full_duration))
        END AS session_retention_pct
      FROM session_rollup
      WHERE segment_hits >= ? AND max_bounded_seconds >= ?
    )
    SELECT video_id, session_id, session_retention_pct
    FROM qualified
    WHERE session_retention_pct IS NOT NULL
  `
}

export async function buildSegmentAnalyticsSnapshotWithOptions(db: any, env: any, options: AnalyticsQueryOptions) {
  const sessionExpr = canonicalSessionExpression()
  const now = new Date()
  const days = daysForRange(options.range)
  const startAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  const bucketByCreated = bucketExpr('created_at', options.granularity)
  const bucketByUpdated = bucketExpr('updated_at', options.granularity)
  const bucketByPeriodEnd = bucketExpr('current_period_end', options.granularity)

  const [monthlyPriceRaw, yearlyPriceRaw, clubPriceRaw] = env
    ? await Promise.all([
      getSetting(env, 'monthly_price_eur'),
      getSetting(env, 'yearly_price_eur'),
      getSetting(env, 'club_price_eur'),
    ])
    : [null, null, null]
  const monthlyPriceEur = parseNumericSetting(monthlyPriceRaw, 0)
  const yearlyPriceEur = parseNumericSetting(yearlyPriceRaw, 0)
  const clubPriceEur = parseNumericSetting(clubPriceRaw, 0)
  const [minSegmentsRaw, minWatchSecondsRaw] = env
    ? await Promise.all([
      getSetting(env, 'analytics_view_min_segments'),
      getSetting(env, 'analytics_view_min_watch_seconds'),
    ])
    : [null, null]
  const minSegmentsPerView = parseNonNegativeInt(minSegmentsRaw, 1)
  const minWatchSecondsPerView = parseNonNegativeInt(minWatchSecondsRaw, 15)

  const [views, sourceRows, globalRetentionRow, videoStatsRows, subsStatusRows, viewsSeriesRows, watchTimeTotalRow, watchTimeSeriesRows, segmentRequestsRow, countryViewsRows, countryWatchTimeRows, subscriptionNewRows, subscriptionChurnRows, subscriptionExpiringRows, planBreakdownRows] = await Promise.all([
    db.prepare(`
      WITH session_rollup AS (
        SELECT
          ${sessionExpr} AS session_id,
          video_id,
          COUNT(*) AS segment_hits,
          MAX(COALESCE(playback_position_seconds, position_seconds, 0)) AS max_watch_seconds
        FROM video_segment_events
        WHERE event_type = 'segment'
          AND datetime(created_at) >= datetime(?)
        GROUP BY session_id, video_id
      )
      SELECT COUNT(DISTINCT session_id) AS total
      FROM session_rollup
      WHERE segment_hits >= ? AND max_watch_seconds >= ?
    `).bind(startAt, minSegmentsPerView, minWatchSecondsPerView).first(),
    db.prepare(`
      WITH session_rollup AS (
        SELECT
          ${sessionExpr} AS session_id,
          video_id,
          COALESCE(source_category, 'direct') AS source,
          COUNT(*) AS segment_hits,
          MAX(COALESCE(playback_position_seconds, position_seconds, 0)) AS max_watch_seconds
        FROM video_segment_events
        WHERE event_type = 'segment'
          AND datetime(created_at) >= datetime(?)
        GROUP BY session_id, video_id, source
      )
      SELECT
        source,
        COUNT(DISTINCT session_id) AS unique_sessions,
        COUNT(DISTINCT session_id) AS hits
      FROM session_rollup
      WHERE segment_hits >= ? AND max_watch_seconds >= ?
      GROUP BY source
      ORDER BY unique_sessions DESC
      LIMIT 12
    `).bind(startAt, minSegmentsPerView, minWatchSecondsPerView).all(),
    db.prepare(`
      WITH session_retention AS (${sessionRetentionCte(sessionExpr)})
      SELECT AVG(session_retention_pct) AS average_retention_percent
      FROM session_retention
    `).bind(startAt, minSegmentsPerView, minWatchSecondsPerView).first(),
    db.prepare(`
      WITH session_retention AS (${sessionRetentionCte(sessionExpr)}),
      per_video AS (
        SELECT
          video_id,
          COUNT(DISTINCT session_id) AS view_count,
          AVG(session_retention_pct) AS average_retention_percent,
          AVG(CASE WHEN session_retention_pct >= 90 THEN 100.0 ELSE 0.0 END) AS completion_rate_percent,
          SUM(
            CASE
              WHEN session_retention_pct IS NULL THEN 0
              ELSE session_retention_pct
            END
          ) AS retention_score_sum
        FROM session_retention
        GROUP BY video_id
      ),
      watch_time AS (
        SELECT
          video_id,
          SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds
        FROM video_segment_events
        WHERE event_type = 'segment'
          AND datetime(created_at) >= datetime(?)
        GROUP BY video_id
      )
      SELECT
        v.id AS video_id,
        v.title AS title,
        v.slug AS slug,
        v.published_at AS published_at,
        v.full_duration AS full_duration,
        COALESCE(pv.view_count, 0) AS view_count,
        pv.average_retention_percent AS average_retention_percent,
        pv.completion_rate_percent AS completion_rate_percent,
        COALESCE(wt.total_watch_seconds, 0) AS total_watch_seconds
      FROM videos v
      LEFT JOIN per_video pv ON pv.video_id = v.id
      LEFT JOIN watch_time wt ON wt.video_id = v.id
      WHERE v.publish_status = 'published'
      ORDER BY view_count DESC, title ASC
    `).bind(startAt, minSegmentsPerView, minWatchSecondsPerView, startAt).all(),
    db.prepare(`
      WITH latest_subscription AS (
        SELECT s.*
        FROM subscriptions s
        INNER JOIN (
          SELECT user_id, MAX(datetime(COALESCE(updated_at, created_at))) AS latest_change
          FROM subscriptions
          GROUP BY user_id
        ) latest ON latest.user_id = s.user_id AND datetime(COALESCE(s.updated_at, s.created_at)) = latest.latest_change
      )
      SELECT COALESCE(status, 'none') AS status, COUNT(*) AS count
      FROM latest_subscription
      GROUP BY status
      ORDER BY count DESC, status ASC
    `).all(),
    db.prepare(`
      WITH session_rollup AS (
        SELECT
          ${sessionExpr} AS session_id,
          video_id,
          ${bucketByCreated} AS bucket,
          COUNT(*) AS segment_hits,
          MAX(COALESCE(playback_position_seconds, position_seconds, 0)) AS max_watch_seconds
        FROM video_segment_events
        WHERE event_type = 'segment'
          AND datetime(created_at) >= datetime(?)
        GROUP BY session_id, video_id, bucket
      )
      SELECT
        bucket,
        COUNT(DISTINCT session_id) AS unique_sessions
      FROM session_rollup
      WHERE segment_hits >= ? AND max_watch_seconds >= ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(startAt, minSegmentsPerView, minWatchSecondsPerView).all(),
    db.prepare(`
      SELECT SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds
      FROM video_segment_events
      WHERE event_type = 'segment'
        AND datetime(created_at) >= datetime(?)
    `).bind(startAt).first(),
    db.prepare(`
      SELECT
        ${bucketByCreated} AS bucket,
        SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds
      FROM video_segment_events
      WHERE event_type = 'segment'
        AND datetime(created_at) >= datetime(?)
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(startAt).all(),
    db.prepare(`
      SELECT COUNT(*) AS total
      FROM video_segment_events
      WHERE event_type = 'segment'
        AND datetime(created_at) >= datetime(?)
    `).bind(startAt).first(),
    db.prepare(`
      WITH base AS (
        SELECT
          ${sessionExpr} AS session_id,
          video_id,
          country_code,
          playback_position_seconds,
          position_seconds,
          created_at,
          ROW_NUMBER() OVER (PARTITION BY ${sessionExpr}, video_id ORDER BY datetime(created_at) ASC) AS event_rank
        FROM video_segment_events
        WHERE event_type = 'segment'
          AND datetime(created_at) >= datetime(?)
      ),
      session_rollup AS (
        SELECT
          session_id,
          video_id,
          MAX(CASE WHEN event_rank = 1 THEN country_code END) AS country_code,
          COUNT(*) AS segment_hits,
          MAX(COALESCE(playback_position_seconds, position_seconds, 0)) AS max_watch_seconds
        FROM base
        GROUP BY session_id, video_id
      )
      SELECT
        country_code AS country,
        COUNT(DISTINCT session_id) AS unique_sessions
      FROM session_rollup
      WHERE segment_hits >= ?
        AND max_watch_seconds >= ?
        AND country_code IS NOT NULL
        AND country_code NOT IN ('XX', 'T1', '')
      GROUP BY country_code
      ORDER BY unique_sessions DESC
      LIMIT 20
    `).bind(startAt, minSegmentsPerView, minWatchSecondsPerView).all(),
    db.prepare(`
      SELECT
        country_code AS country,
        SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds
      FROM video_segment_events
      WHERE event_type = 'segment'
        AND datetime(created_at) >= datetime(?)
        AND country_code IS NOT NULL
        AND country_code NOT IN ('XX', 'T1', '')
      GROUP BY country_code
      ORDER BY total_watch_seconds DESC
      LIMIT 20
    `).bind(startAt).all(),
    db.prepare(`
      SELECT
        ${bucketByCreated} AS bucket,
        COUNT(*) AS new_subscriptions
      FROM subscriptions
      WHERE datetime(created_at) >= datetime(?)
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(startAt).all(),
    db.prepare(`
      SELECT
        ${bucketByUpdated} AS bucket,
        COUNT(*) AS churned_subscriptions
      FROM subscriptions
      WHERE datetime(updated_at) >= datetime(?)
        AND status IN ('cancelled', 'unpaid')
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(startAt).all(),
    db.prepare(`
      SELECT
        ${bucketByPeriodEnd} AS bucket,
        COUNT(*) AS expiring_subscriptions
      FROM subscriptions
      WHERE current_period_end IS NOT NULL
        AND datetime(current_period_end) >= datetime(?)
        AND datetime(current_period_end) <= datetime(?)
        AND status IN ('active', 'trialing', 'past_due')
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(startAt, now.toISOString()).all(),
    db.prepare(`
      WITH latest_subscription AS (
        SELECT s.*
        FROM subscriptions s
        INNER JOIN (
          SELECT user_id, MAX(datetime(COALESCE(updated_at, created_at))) AS latest_change
          FROM subscriptions
          GROUP BY user_id
        ) latest ON latest.user_id = s.user_id AND datetime(COALESCE(s.updated_at, s.created_at)) = latest.latest_change
      )
      SELECT plan_type, COUNT(*) AS active_count
      FROM latest_subscription
      WHERE status IN ('active', 'trialing')
      GROUP BY plan_type
    `).all(),
  ])

  const viewSeries = Array.isArray(viewsSeriesRows?.results)
    ? viewsSeriesRows.results.map((row: any) => ({
      bucket: String(row.bucket),
      uniqueSessions: Number(row.unique_sessions || 0),
    }))
    : []

  const watchTimeSeries = Array.isArray(watchTimeSeriesRows?.results)
    ? watchTimeSeriesRows.results.map((row: any) => ({
      bucket: String(row.bucket),
      totalWatchSeconds: Number(row.total_watch_seconds || 0),
    }))
    : []

  const totalWatchSeconds = Number(watchTimeTotalRow?.total_watch_seconds || 0)
  const segmentRequests = Number(segmentRequestsRow?.total || 0)

  const countryViews = (countryViewsRows?.results ?? []).map((row: any) => ({
    country: String(row.country),
    uniqueSessions: Number(row.unique_sessions || 0),
  }))

  const countryWatchTime = (countryWatchTimeRows?.results ?? []).map((row: any) => ({
    country: String(row.country),
    totalWatchSeconds: Number(row.total_watch_seconds || 0),
  }))

  let heatmap: {
    videoId: string
    bucketCount: number
    buckets: ReturnType<typeof buildHeatmapSeries>
    maxWatchSeconds: number
  } | null = null
  if (options.videoId) {
    const heatmapRows = await db.prepare(`
      WITH events AS (
        SELECT
          e.playback_position_seconds,
          e.position_seconds,
          e.segment_duration_seconds,
          v.full_duration
        FROM video_segment_events e
        INNER JOIN videos v ON v.id = e.video_id
        WHERE e.event_type = 'segment'
          AND e.video_id = ?
          AND datetime(e.created_at) >= datetime(?)
      )
      SELECT
        CASE
          WHEN full_duration IS NULL OR full_duration <= 0 THEN NULL
          WHEN playback_position_seconds IS NOT NULL THEN MIN(99, MAX(0, CAST(playback_position_seconds * 100.0 / full_duration AS INTEGER)))
          WHEN position_seconds IS NOT NULL THEN MIN(99, MAX(0, CAST(position_seconds * 100.0 / full_duration AS INTEGER)))
          ELSE NULL
        END AS bucket_pct,
        SUM(COALESCE(segment_duration_seconds, 6)) AS watch_seconds,
        COUNT(*) AS segment_hits
      FROM events
      GROUP BY bucket_pct
      HAVING bucket_pct IS NOT NULL
      ORDER BY bucket_pct ASC
    `).bind(options.videoId, startAt).all()
    const buckets = buildHeatmapSeries((heatmapRows?.results ?? []).map((row: any) => ({
      bucket_pct: Number(row.bucket_pct),
      watch_seconds: Number(row.watch_seconds || 0),
      segment_hits: Number(row.segment_hits || 0),
    })))
    heatmap = {
      videoId: options.videoId,
      bucketCount: buckets.length,
      buckets,
      maxWatchSeconds: buckets.reduce((max, bucket) => Math.max(max, bucket.watchSeconds), 0),
    }
  }

  const subscriptionTrendsMap = new Map<string, { bucket: string, newSubscriptions: number, churnedSubscriptions: number, expiringSubscriptions: number }>()
  for (const row of (subscriptionNewRows?.results ?? [])) {
    const bucket = String(row.bucket)
    subscriptionTrendsMap.set(bucket, {
      bucket,
      newSubscriptions: Number(row.new_subscriptions || 0),
      churnedSubscriptions: 0,
      expiringSubscriptions: 0,
    })
  }
  for (const row of (subscriptionChurnRows?.results ?? [])) {
    const bucket = String(row.bucket)
    const current = subscriptionTrendsMap.get(bucket) || {
      bucket,
      newSubscriptions: 0,
      churnedSubscriptions: 0,
      expiringSubscriptions: 0,
    }
    current.churnedSubscriptions = Number(row.churned_subscriptions || 0)
    subscriptionTrendsMap.set(bucket, current)
  }
  for (const row of (subscriptionExpiringRows?.results ?? [])) {
    const bucket = String(row.bucket)
    const current = subscriptionTrendsMap.get(bucket) || {
      bucket,
      newSubscriptions: 0,
      churnedSubscriptions: 0,
      expiringSubscriptions: 0,
    }
    current.expiringSubscriptions = Number(row.expiring_subscriptions || 0)
    subscriptionTrendsMap.set(bucket, current)
  }
  const subscriptionTrends = Array.from(subscriptionTrendsMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket))

  const monthlyPriceByPlan: Record<'monthly' | 'yearly' | 'club', number> = {
    monthly: monthlyPriceEur,
    yearly: yearlyPriceEur > 0 ? yearlyPriceEur / 12 : 0,
    club: clubPriceEur,
  }

  const activeMrrEstimateEur = (planBreakdownRows?.results ?? []).reduce((sum: number, row: any) => {
    const rawPlan = typeof row.plan_type === 'string' ? row.plan_type : 'monthly'
    const plan: keyof typeof monthlyPriceByPlan = rawPlan === 'yearly' || rawPlan === 'club' ? rawPlan : 'monthly'
    const price = monthlyPriceByPlan[plan] ?? 0
    return sum + (Number(row.active_count || 0) * price)
  }, 0)

  const monthlyBasePrice = monthlyPriceByPlan.monthly
  const cashflowTrend = subscriptionTrends.map((row) => {
    const estimatedNewRevenueEur = row.newSubscriptions * monthlyBasePrice
    return {
      bucket: row.bucket,
      estimatedNewRevenueEur: Number(estimatedNewRevenueEur.toFixed(2)),
      estimatedNetNewEur: Number((estimatedNewRevenueEur - (row.churnedSubscriptions * monthlyBasePrice)).toFixed(2)),
    }
  })

  const totalViews = Number(views?.total || 0)
  const totalNewSubscriptions = subscriptionTrends.reduce((sum, row) => sum + row.newSubscriptions, 0)
  const totalChurnedSubscriptions = subscriptionTrends.reduce((sum, row) => sum + row.churnedSubscriptions, 0)
  const churnRate = totalNewSubscriptions > 0 ? Number(((totalChurnedSubscriptions / totalNewSubscriptions) * 100).toFixed(2)) : 0
  const averageRetentionPercent = Number(Number(globalRetentionRow?.average_retention_percent ?? 0).toFixed(2))

  const videoStats = (videoStatsRows?.results ?? []).map((row: any) => {
    const averageRetentionPercent = row.average_retention_percent == null
      ? null
      : Number(Number(row.average_retention_percent).toFixed(2))
    const completionRatePercent = row.completion_rate_percent == null
      ? null
      : Number(Number(row.completion_rate_percent).toFixed(2))
    return {
      videoId: String(row.video_id),
      title: String(row.title ?? ''),
      slug: row.slug ? String(row.slug) : null,
      publishedAt: row.published_at ? String(row.published_at) : null,
      viewCount: Number(row.view_count || 0),
      totalWatchSeconds: Number(row.total_watch_seconds || 0),
      averageRetentionPercent,
      completionRatePercent,
      engagementScore: computeEngagementScore(averageRetentionPercent, completionRatePercent),
    }
  })

  const kpis = {
    totalUniqueViews: totalViews,
    totalWatchSeconds,
    totalWatchTimeLabel: formatWatchSeconds(totalWatchSeconds),
    segmentRequests,
    averageRetentionPercent,
    activeSubscribers: Number((planBreakdownRows?.results ?? []).reduce((sum: number, row: any) => sum + Number(row.active_count || 0), 0)),
    churnRatePercent: churnRate,
    estimatedActiveMrrEur: Number(activeMrrEstimateEur.toFixed(2)),
  }

  const definitions = {
    totalUniqueViews: 'Playback starts counted once per viewer session per video after min segment/watch thresholds.',
    totalWatchSeconds: 'Cumulative seconds watched across all segment requests; rewatches and repeat visits add to the total.',
    segmentRequests: 'Total HLS segment requests served in the selected range.',
    averageRetentionPercent: 'Average max watch-through percent across qualified sessions in the selected range.',
    activeSubscribers: 'Users whose latest subscription status is active or trialing.',
    churnRatePercent: 'Churned subscriptions divided by new subscriptions in the selected range.',
    estimatedActiveMrrEur: 'Approximate monthly recurring revenue from active/trialing users using admin configured prices.',
    engagementScore: 'Video-level score from 0–100 based on retention depth and completion rate (sessions reaching 90%+ watch-through).',
    countryViews: 'Playback starts by country using IP geolocation at the first segment request in each session.',
    countryWatchTime: 'Cumulative watch seconds by country; rewatches add to the total.',
    heatmap: 'Timeline engagement for one video: watch intensity by position percent (0–99).',
  }

  return {
    meta: {
      range: options.range,
      granularity: options.granularity,
      dataset: options.dataset,
      videoId: options.videoId,
      startAt,
      endAt: now.toISOString(),
      generatedAt: now.toISOString(),
    },
    kpis,
    definitions,
    views: {
      totalUniqueSessions: totalViews,
      series: viewSeries,
    },
    watchTime: {
      totalSeconds: totalWatchSeconds,
      totalLabel: formatWatchSeconds(totalWatchSeconds),
      series: watchTimeSeries,
    },
    countries: {
      views: countryViews,
      watchTime: countryWatchTime,
    },
    heatmap,
    trafficSources: sourceRows?.results ?? [],
    videoStats,
    subscriptionOverview: {
      statusBreakdown: subsStatusRows?.results ?? [],
      trends: subscriptionTrends,
    },
    cashflow: {
      currency: 'EUR',
      activeMrrEstimateEur: Number(activeMrrEstimateEur.toFixed(2)),
      trend: cashflowTrend,
      planMonthlyPriceEur: monthlyPriceByPlan,
    },
    // Backward-compatible summary fields used by existing clients/tests.
    totalViews,
    subscriptionsLegacy: subsStatusRows?.results ?? [],
    subscriptions: subsStatusRows?.results ?? [],
  }
}

function escapeCsvCell(value: unknown) {
  if (value == null) return ''
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function buildAnalyticsCsvExport(snapshot: any, dataset: AnalyticsDataset) {
  const rows: string[] = []
  if (dataset === 'views') {
    rows.push('bucket,unique_sessions')
    for (const row of (snapshot.views?.series ?? [])) {
      rows.push(`${escapeCsvCell(row.bucket)},${escapeCsvCell(row.uniqueSessions)}`)
    }
    return rows.join('\n')
  }
  if (dataset === 'watchtime') {
    rows.push('bucket,total_watch_seconds')
    for (const row of (snapshot.watchTime?.series ?? [])) {
      rows.push(`${escapeCsvCell(row.bucket)},${escapeCsvCell(row.totalWatchSeconds)}`)
    }
    return rows.join('\n')
  }
  if (dataset === 'retention') {
    rows.push('format:retention_per_video_v1')
    rows.push('video_id,title,view_count,total_watch_seconds,average_retention_percent,engagement_score')
    for (const row of (snapshot.videoStats ?? [])) {
      rows.push(`${escapeCsvCell(row.videoId)},${escapeCsvCell(row.title)},${escapeCsvCell(row.viewCount)},${escapeCsvCell(row.totalWatchSeconds ?? 0)},${escapeCsvCell(row.averageRetentionPercent ?? '')},${escapeCsvCell(row.engagementScore ?? '')}`)
    }
    return rows.join('\n')
  }
  if (dataset === 'sources') {
    rows.push('source,unique_sessions')
    for (const row of (snapshot.trafficSources ?? [])) {
      rows.push(`${escapeCsvCell(row.source)},${escapeCsvCell(row.unique_sessions)}`)
    }
    return rows.join('\n')
  }
  if (dataset === 'countries') {
    rows.push('country,unique_sessions,total_watch_seconds')
    const watchByCountry = new Map<string, number>()
    for (const row of (snapshot.countries?.watchTime ?? [])) {
      watchByCountry.set(String(row.country), Number(row.totalWatchSeconds || 0))
    }
    const countries = new Set<string>([
      ...(snapshot.countries?.views ?? []).map((row: any) => String(row.country)),
      ...(snapshot.countries?.watchTime ?? []).map((row: any) => String(row.country)),
    ])
    for (const country of Array.from(countries).sort()) {
      const viewsRow = (snapshot.countries?.views ?? []).find((row: any) => String(row.country) === country)
      rows.push(`${escapeCsvCell(country)},${escapeCsvCell(viewsRow?.uniqueSessions ?? 0)},${escapeCsvCell(watchByCountry.get(country) ?? 0)}`)
    }
    return rows.join('\n')
  }
  if (dataset === 'subscriptions') {
    rows.push('bucket,new_subscriptions,churned_subscriptions,expiring_subscriptions')
    for (const row of (snapshot.subscriptionOverview?.trends ?? [])) {
      rows.push(`${escapeCsvCell(row.bucket)},${escapeCsvCell(row.newSubscriptions)},${escapeCsvCell(row.churnedSubscriptions)},${escapeCsvCell(row.expiringSubscriptions)}`)
    }
    return rows.join('\n')
  }
  if (dataset === 'cashflow') {
    rows.push('bucket,estimated_new_revenue_eur,estimated_net_new_eur')
    for (const row of (snapshot.cashflow?.trend ?? [])) {
      rows.push(`${escapeCsvCell(row.bucket)},${escapeCsvCell(row.estimatedNewRevenueEur)},${escapeCsvCell(row.estimatedNetNewEur)}`)
    }
    return rows.join('\n')
  }
  rows.push('kpi,value,definition')
  for (const key of Object.keys(snapshot.kpis ?? {})) {
    rows.push(`${escapeCsvCell(key)},${escapeCsvCell(snapshot.kpis[key])},${escapeCsvCell(snapshot.definitions?.[key] ?? '')}`)
  }
  return rows.join('\n')
}

function normalizeSourceHost(rawHost: any) {
  if (typeof rawHost !== 'string' || !rawHost.trim()) return ''
  return rawHost.trim().toLowerCase().replace(/^www\./, '').split(':')[0] || ''
}

const SEARCH_TRAFFIC_HOST_MARKERS = ['google.', 'bing.', 'duckduckgo.', 'search.yahoo.', 'yandex.', 'baidu.']
const SOCIAL_TRAFFIC_HOST_MARKERS = ['facebook.', 'instagram.', 'x.com', 't.co', 'linkedin.', 'reddit.', 'tiktok.', 'pinterest.', 'youtube.']

function hostMatches(host: string, markers: string[]) {
  return markers.some((marker) => host === marker || host.endsWith(`.${marker}`) || host.includes(marker))
}

export function classifySegmentSource(payload: any) {
  const refererRaw = typeof payload?.referer === 'string' ? payload.referer : ''
  let sourceHost = normalizeSourceHost(payload?.sourceHost)
  let campaignSource = null
  let campaignMedium = null
  if (refererRaw) {
    try {
      const refererUrl = new URL(refererRaw)
      sourceHost = sourceHost || normalizeSourceHost(refererUrl.host)
      campaignSource = refererUrl.searchParams.get('utm_source')
      campaignMedium = refererUrl.searchParams.get('utm_medium')
    } catch {
      // Keep direct attribution for malformed referers.
    }
  }
  if (campaignSource || campaignMedium) {
    return {
      category: 'campaign',
      detail: campaignSource || campaignMedium || sourceHost || 'campaign',
      sourceHost: sourceHost || null,
      campaignSource,
      campaignMedium,
    }
  }
  if (!sourceHost) {
    return {
      category: 'direct',
      detail: 'direct',
      sourceHost: null,
      campaignSource: null,
      campaignMedium: null,
    }
  }
  if (hostMatches(sourceHost, SEARCH_TRAFFIC_HOST_MARKERS)) {
    return {
      category: 'search',
      detail: sourceHost,
      sourceHost,
      campaignSource: null,
      campaignMedium: null,
    }
  }
  if (hostMatches(sourceHost, SOCIAL_TRAFFIC_HOST_MARKERS)) {
    return {
      category: 'social',
      detail: sourceHost,
      sourceHost,
      campaignSource: null,
      campaignMedium: null,
    }
  }
  return {
    category: 'referral',
    detail: sourceHost,
    sourceHost,
    campaignSource: null,
    campaignMedium: null,
  }
}

export function derivePlaybackPositionSeconds(payload: any) {
  if (Number.isFinite(payload?.playbackPositionSeconds)) {
    return Math.max(0, Number(payload.playbackPositionSeconds))
  }
  const segmentIndex = Number.isFinite(payload?.segmentIndex) ? Number(payload.segmentIndex) : null
  const segmentDuration = Number.isFinite(payload?.segmentDurationSeconds) ? Number(payload.segmentDurationSeconds) : null
  if (segmentIndex != null && segmentIndex >= 0 && segmentDuration != null && segmentDuration > 0) {
    return segmentIndex * segmentDuration
  }
  if (Number.isFinite(payload?.positionSeconds)) return Math.max(0, Number(payload.positionSeconds))
  if (segmentIndex != null && segmentIndex >= 0) return segmentIndex
  return null
}

export function buildSegmentSessionKey(payload: any) {
  const videoId = typeof payload?.videoId === 'string' && payload.videoId.trim() ? payload.videoId.trim() : 'unknown'
  const userId = typeof payload?.userId === 'string' && payload.userId.trim() ? payload.userId.trim() : ''
  const ipHash = typeof payload?.ipHash === 'string' && payload.ipHash.trim() ? payload.ipHash.trim() : ''
  const actorKey = userId ? `u:${userId}` : (ipHash ? `i:${ipHash}` : 'anon')
  const eventTimestampMs = Number.isFinite(payload?.timestampMs) ? Number(payload.timestampMs) : Date.now()
  const sessionBucket = Math.floor(eventTimestampMs / (30 * 60 * 1000))
  return `${videoId}:${actorKey}:${sessionBucket}`
}

export async function logSegmentEvent(env: any, payload: any) {
  const db = getDb(env)
  const requestPath = typeof payload?.requestPath === 'string' ? payload.requestPath : ''
  const eventType = typeof payload?.eventType === 'string' ? payload.eventType : 'segment'
  if (!requestPath) return
  const source = classifySegmentSource(payload)
  const segmentIndex = Number.isFinite(payload?.segmentIndex) ? Number(payload.segmentIndex) : null
  const segmentDuration = Number.isFinite(payload?.segmentDurationSeconds) ? Number(payload.segmentDurationSeconds) : null
  const playbackPosition = derivePlaybackPositionSeconds({
    ...payload,
    segmentIndex,
    segmentDurationSeconds: segmentDuration,
  })
  const sessionKey = buildSegmentSessionKey(payload)
  const videoId = payload.videoId || 'unknown'
  const countryCode = normalizeCountryCode(payload?.countryCode)
  await db.prepare(`
    INSERT INTO video_segment_events (
      id, video_id, user_id, request_path, event_type, position_seconds, referer, source_host, ip_hash,
      segment_index, segment_duration_seconds, playback_position_seconds, session_key,
      source_category, source_detail, campaign_source, campaign_medium, country_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    crypto.randomUUID(),
    videoId,
    payload.userId || null,
    requestPath,
    eventType,
    segmentIndex,
    payload.referer || null,
    source.sourceHost || null,
    payload.ipHash || null,
    segmentIndex,
    segmentDuration,
    playbackPosition,
    sessionKey,
    source.category,
    source.detail,
    source.campaignSource,
    source.campaignMedium,
    countryCode,
  ).run()

  if (eventType === 'segment' && videoId !== 'unknown') {
    const sessionInsert = await db.prepare(`
      INSERT OR IGNORE INTO video_view_count_sessions (video_id, session_id) VALUES (?, ?)
    `).bind(videoId, sessionKey).run()
    if ((sessionInsert.meta?.changes ?? 0) > 0) {
      await db.prepare(`
        INSERT INTO video_view_counts (video_id, view_count, updated_at)
        VALUES (?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(video_id) DO UPDATE SET
          view_count = view_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(videoId).run()
    }
    log({
      service: 'segment_analytics',
      event: 'segment_logged',
      video_id: videoId,
      source_category: source.category,
      has_user: Boolean(payload.userId),
      is_new_session: (sessionInsert.meta?.changes ?? 0) > 0,
    })
  }
}