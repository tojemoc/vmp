/**
 * Legacy payment migration — evaluation notes and admin tooling.
 *
 * ## Phase 1 evaluation (2026-06)
 *
 * ### a) purchase_id lifecycle
 * - Stored on CSV import (provider=legacy, status=needs_relink) and after checkout/webhook.
 * - Unique partial index on purchase_id (migration 0029) prevents duplicate tokens.
 * - After relink: provider_customer_id and purchase_id converge; provider_subscription_id = legacy provider idOrder.
 * - Import rows use provider_customer_id = import-list:{mailingListId} until relink.
 * - Legacy provider maps purchase_id → cardOnFile on POST /order (not purchaseId field).
 *
 * ### b) needs_relink sentinel
 * - Written only by handleAdminUserImportCsv. Not in SUBSCRIPTION_STATUSES.
 * - Premium/access queries use status IN (active, trialing) — needs_relink excluded.
 * - migration_integrity_check.sh does not validate subscription statuses (no false positives).
 * - Analytics statusBreakdown includes needs_relink as its own bucket.
 *
 * ### c) Sandbox safety
 * - LEGACY_ESHOP_SANDBOX_API_URL optional; production LEGACY_ESHOP_API_URL required for real migration tokens.
 * - Batch validation defaults to production; sandbox target available for integration testing.
 *
 * ### d) Webhook reliability
 * - handleLegacyWebhook matches purchase_id OR provider_subscription_id OR provider_customer_id LIMIT 1.
 * - Unique purchase_id index prevents two rows sharing the same token.
 *
 * ### e) Admin subscription UI
 * - needs_relink not in subscription select options; policy blocks transitions without reset to none.
 * - Legacy migration admin tab provides health metrics and validation tooling.
 *
 * ### f) Validation signal (legacy sandbox/production probes)
 * - POST /order with cardOnFile: synchronous 400 reason=cardOnFile → invalid token.
 * - 200 with gateway links → token accepted (not proof of successful charge).
 */

import { requireRole } from './auth.js'
import {
  getLegacyApiBase,
  getLegacySandboxApiBase,
  getLegacyValidationApiBase,
  isLegacyProviderConfigured,
  isLegacySandboxConfigured,
  probeLegacyCardOnFile,
} from './legacyProvider.js'

type LegacyMigrationEnv = {
  DB?: D1Database
  video_subscription_db?: D1Database
  BREVO_API_KEY?: string
  FRONTEND_URL?: string
  SENDER_EMAIL?: string
  SENDER_NAME?: string
  LEGACY_ESHOP_API_URL?: string
  LEGACY_ESHOP_SANDBOX_API_URL?: string
  LEGACY_ESHOP_MERCHANT_ID?: string
  LEGACY_ESHOP_API_KEY?: string
}

type DbBinding = D1Database

const DEFAULT_RELINK_STALE_DAYS = 0
const MAX_RELINK_EMAILS_PER_CALL = 50
const VALIDATION_DELAY_MS = 100
const BREVO_EMAIL_TIMEOUT_MS = 15_000
const CSV_EXPORT_MAX_PAGES = 200

function getDb(env: LegacyMigrationEnv): DbBinding {
  const db = env.DB ?? env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  const visible = local.slice(0, Math.min(3, local.length))
  return `${visible}***${domain}`
}

function truncatePurchaseId(purchaseId: string): string {
  const value = String(purchaseId ?? '').trim()
  if (value.length <= 8) return value
  return `…${value.slice(-8)}`
}

function buildAdminAuditLogStatement(
  db: DbBinding,
  input: {
    actorUserId: string
    actionType: string
    targetUserId: string | null
    detail: Record<string, unknown>
  },
) {
  return db.prepare(`
    INSERT INTO admin_audit_logs (id, actor_user_id, action_type, target_user_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    crypto.randomUUID(),
    input.actorUserId,
    input.actionType,
    input.targetUserId,
    JSON.stringify(input.detail ?? {}),
  )
}

export type MigrationStats = {
  total_imported: number
  needs_relink: number
  active: number
  failed: number
  not_validated: number
  churn_rate_pct: number
  sandboxConfigured: boolean
  productionConfigured: boolean
  validationApiBase: string | null
}

export async function getMigrationStats(db: DbBinding, env: LegacyMigrationEnv): Promise<MigrationStats> {
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN provider = 'legacy' THEN 1 ELSE 0 END) AS total_imported,
      SUM(CASE WHEN status = 'needs_relink' THEN 1 ELSE 0 END) AS needs_relink,
      SUM(CASE WHEN provider = 'legacy' AND status IN ('active', 'trialing') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN provider = 'legacy' AND legacy_validation_status = 'invalid' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN provider = 'legacy' AND status = 'needs_relink' AND legacy_validation_status IS NULL THEN 1 ELSE 0 END) AS not_validated
    FROM subscriptions
  `).first()

  const totalImported = Number(row?.total_imported ?? 0)
  const needsRelink = Number(row?.needs_relink ?? 0)
  const active = Number(row?.active ?? 0)
  const failed = Number(row?.failed ?? 0)
  const notValidated = Number(row?.not_validated ?? 0)
  const denominator = active + failed
  const churnRatePct = denominator > 0 ? Math.round((failed / denominator) * 1000) / 10 : 0

  const productionConfigured = Boolean(getLegacyApiBase(env))
  const sandboxConfigured = isLegacySandboxConfigured(env)

  return {
    total_imported: totalImported,
    needs_relink: needsRelink,
    active,
    failed,
    not_validated: notValidated,
    churn_rate_pct: churnRatePct,
    sandboxConfigured,
    productionConfigured,
    validationApiBase: productionConfigured ? getLegacyApiBase(env) : (sandboxConfigured ? getLegacySandboxApiBase(env) : null),
  }
}

export type ValidateLegacyBatchResult = {
  processed: number
  valid: number
  invalid: number
  errors: number
  validationTarget: 'sandbox' | 'production'
  details: Array<{
    subscriptionId: string
    userId: string
    purchaseId: string
    result: 'valid' | 'invalid' | 'error'
    httpStatus?: number
    errorMessage?: string
  }>
}

export async function validateLegacyBatch(
  db: DbBinding,
  env: LegacyMigrationEnv,
  batchSize: number,
  dryRun: boolean,
  validationTarget: 'sandbox' | 'production' = 'production',
): Promise<ValidateLegacyBatchResult> {
  if (!isLegacyProviderConfigured(env, validationTarget)) {
    throw new Error(`Legacy billing is not configured for ${validationTarget}`)
  }

  const apiBase = getLegacyValidationApiBase(env, validationTarget)
  if (validationTarget === 'production') {
    console.warn('[legacy-migration] Validating against production legacy billing API — probe orders may be created.')
  }

  const limit = Math.min(Math.max(batchSize, 1), 100)
  const rows = await db.prepare(`
    SELECT id, user_id, purchase_id, plan_type
    FROM subscriptions
    WHERE provider = 'legacy'
      AND status = 'needs_relink'
      AND legacy_validation_status IS NULL
      AND purchase_id IS NOT NULL
      AND trim(purchase_id) <> ''
    ORDER BY datetime(created_at) ASC
    LIMIT ?
  `).bind(limit).all()

  const details: ValidateLegacyBatchResult['details'] = []
  let valid = 0
  let invalid = 0
  let errors = 0

  for (const row of rows.results ?? []) {
    const subscriptionId = String(row.id)
    const userId = String(row.user_id)
    const purchaseId = String(row.purchase_id)
    const idOrder = crypto.randomUUID()

    const probe = await probeLegacyCardOnFile(env, apiBase, {
      purchaseId,
      idOrder,
      planType: String(row.plan_type ?? 'monthly'),
    })

    details.push({
      subscriptionId,
      userId,
      purchaseId: truncatePurchaseId(purchaseId),
      result: probe.result,
      ...(probe.httpStatus != null ? { httpStatus: probe.httpStatus } : {}),
      ...(probe.errorMessage ? { errorMessage: probe.errorMessage } : {}),
    })

    if (probe.result === 'valid') valid += 1
    else if (probe.result === 'invalid') invalid += 1
    else errors += 1

    if (!dryRun) {
      const now = new Date().toISOString()
      await db.prepare(`
        UPDATE subscriptions
        SET legacy_validation_status = ?,
            legacy_validated_at = ?,
            legacy_validation_error = ?,
            updated_at = ?
        WHERE id = ?
      `).bind(
        probe.result,
        now,
        probe.errorMessage ?? null,
        now,
        subscriptionId,
      ).run()
    }

    await sleep(VALIDATION_DELAY_MS)
  }

  return {
    processed: details.length,
    valid,
    invalid,
    errors,
    validationTarget,
    details,
  }
}

export type RelinkCandidate = {
  userId: string
  email: string
  provider: string
  purchaseId: string | null
  providerCustomerId: string | null
  validationStatus: string | null
  validatedAt: string | null
  importedAt: string
}

export async function getRelinkCandidates(
  db: DbBinding,
  page: number,
  pageSize: number,
  staleDays = DEFAULT_RELINK_STALE_DAYS,
): Promise<{ users: RelinkCandidate[]; total: number }> {
  const safePage = Math.max(1, page)
  const safePageSize = Math.min(Math.max(pageSize, 1), 100)
  const offset = (safePage - 1) * safePageSize
  const safeStaleDays = Math.max(0, staleDays)

  const staleClause = safeStaleDays > 0
    ? `OR (
          s.status = 'needs_relink'
          AND datetime(s.created_at) <= datetime('now', ?)
        )`
    : `OR s.status = 'needs_relink'`

  const whereSql = `
    FROM subscriptions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE (
      (s.provider = 'legacy' AND s.legacy_validation_status = 'invalid')
      ${staleClause}
    )
  `

  const countStmt = safeStaleDays > 0
    ? db.prepare(`SELECT COUNT(*) AS n ${whereSql}`).bind(`-${safeStaleDays} days`)
    : db.prepare(`SELECT COUNT(*) AS n ${whereSql}`)
  const countRow = await countStmt.first()
  const total = Number(countRow?.n ?? 0)

  const listStmt = safeStaleDays > 0
    ? db.prepare(`
    SELECT
      s.user_id,
      u.email,
      s.provider,
      s.purchase_id,
      s.stripe_customer_id,
      s.legacy_validation_status,
      s.legacy_validated_at,
      s.created_at
    ${whereSql}
    ORDER BY datetime(s.created_at) ASC
    LIMIT ? OFFSET ?
  `).bind(`-${safeStaleDays} days`, safePageSize, offset)
    : db.prepare(`
    SELECT
      s.user_id,
      u.email,
      s.provider,
      s.purchase_id,
      s.stripe_customer_id,
      s.legacy_validation_status,
      s.legacy_validated_at,
      s.created_at
    ${whereSql}
    ORDER BY datetime(s.created_at) ASC
    LIMIT ? OFFSET ?
  `).bind(safePageSize, offset)
  const listRows = await listStmt.all()

  const users = (listRows.results ?? []).map((row) => ({
    userId: String(row.user_id),
    email: maskEmail(String(row.email ?? '')),
    provider: String(row.provider ?? ''),
    purchaseId: row.purchase_id ? truncatePurchaseId(String(row.purchase_id)) : null,
    providerCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    validationStatus: row.legacy_validation_status ? String(row.legacy_validation_status) : null,
    validatedAt: row.legacy_validated_at ? String(row.legacy_validated_at) : null,
    importedAt: String(row.created_at ?? ''),
  }))

  return { users, total }
}

export function relinkCandidatesToCsv(users: RelinkCandidate[]): string {
  const header = 'user_id,email_masked,provider,purchase_id,provider_customer_id,validation_status,validated_at,imported_at'
  const lines = users.map((u) => [
    u.userId,
    u.email,
    u.provider,
    u.purchaseId ?? '',
    u.providerCustomerId ?? '',
    u.validationStatus ?? '',
    u.validatedAt ?? '',
    u.importedAt,
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
  return [header, ...lines].join('\n')
}

async function sendRelinkEmail(to: string, link: string, env: LegacyMigrationEnv) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': String(env.BREVO_API_KEY ?? ''),
    },
    signal: AbortSignal.timeout(BREVO_EMAIL_TIMEOUT_MS),
    body: JSON.stringify({
      sender: {
        email: env.SENDER_EMAIL || 'noreply@example.com',
        name: env.SENDER_NAME || 'VMP',
      },
      to: [{ email: to }],
      subject: 'Action required: link your subscription',
      htmlContent: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <h2 style="margin:0 0 16px;font-size:22px">Link your payment method</h2>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">
            Your subscription was migrated from our previous platform. To ensure uninterrupted access,
            please link a payment method on your account page.
          </p>
          <a href="${link}"
             style="display:inline-block;padding:12px 24px;background:#2563eb;
                    color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
            Link payment method
          </a>
        </div>
      `,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Brevo email failed (${response.status})`)
  }
}

export async function sendRelinkEmails(
  db: DbBinding,
  env: LegacyMigrationEnv,
  userIds: string[],
  actorUserId: string,
): Promise<{ sent: number; skipped: number }> {
  if (!env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured')
  }
  const uniqueIds = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))]
  if (!uniqueIds.length) return { sent: 0, skipped: 0 }
  if (uniqueIds.length > MAX_RELINK_EMAILS_PER_CALL) {
    throw new Error(`Maximum ${MAX_RELINK_EMAILS_PER_CALL} emails per request`)
  }

  const frontendUrl = String(env.FRONTEND_URL ?? '').trim().replace(/\/$/, '')
  if (!frontendUrl) {
    throw new Error('FRONTEND_URL is not configured')
  }
  const relinkUrl = `${frontendUrl}/account?relink=1`

  let sent = 0
  let skipped = 0

  for (const userId of uniqueIds) {
    const row = await db.prepare(`
      SELECT u.email
      FROM users u
      INNER JOIN subscriptions s ON s.user_id = u.id AND s.status = 'needs_relink'
      WHERE u.id = ?
      LIMIT 1
    `).bind(userId).first()

    if (!row?.email) {
      skipped += 1
      continue
    }

    await sendRelinkEmail(String(row.email), relinkUrl, env)
    await buildAdminAuditLogStatement(db, {
      actorUserId,
      actionType: 'legacy_relink_email_sent',
      targetUserId: userId,
      detail: { relinkUrl },
    }).run()
    sent += 1
  }

  return { sent, skipped }
}

export async function handleAdminLegacyMigrationStats(request: Request, env: LegacyMigrationEnv, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }
  try {
    const stats = await getMigrationStats(getDb(env), env)
    return jsonResponse(stats, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load migration stats'
    return jsonResponse({ error: message }, 500, corsHeaders)
  }
}

export async function handleAdminLegacyMigrationValidateBatch(request: Request, env: LegacyMigrationEnv, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const body = await request.json().catch(() => ({})) as {
    batchSize?: unknown
    dryRun?: unknown
    validationTarget?: unknown
  }
  const batchSize = Number.parseInt(String(body.batchSize ?? 25), 10)
  const dryRun = body.dryRun === true
  const validationTarget = body.validationTarget === 'sandbox' ? 'sandbox' : 'production'

  try {
    const result = await validateLegacyBatch(
      getDb(env),
      env,
      Number.isFinite(batchSize) ? batchSize : 25,
      dryRun,
      validationTarget,
    )
    return jsonResponse(result, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation batch failed'
    return jsonResponse({ error: message, code: 'legacy_validation_failed' }, 502, corsHeaders)
  }
}

export async function handleAdminLegacyMigrationRelinkCandidates(request: Request, env: LegacyMigrationEnv, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const url = new URL(request.url)
  const page = Number.parseInt(url.searchParams.get('page') || '1', 10)
  const pageSize = Number.parseInt(url.searchParams.get('pageSize') || '25', 10)
  const staleDays = Number.parseInt(url.searchParams.get('staleDays') || String(DEFAULT_RELINK_STALE_DAYS), 10)
  const exportCsv = url.searchParams.get('export') === 'csv'

  try {
    if (exportCsv) {
      const allUsers: RelinkCandidate[] = []
      let pageCursor = 1
      const exportPageSize = 100
      let total = 0
      do {
        const pageResult = await getRelinkCandidates(
          getDb(env),
          pageCursor,
          exportPageSize,
          Number.isFinite(staleDays) ? staleDays : DEFAULT_RELINK_STALE_DAYS,
        )
        total = pageResult.total
        allUsers.push(...pageResult.users)
        pageCursor += 1
      } while (allUsers.length < total && pageCursor < CSV_EXPORT_MAX_PAGES)

      if (allUsers.length < total) {
        throw new Error(
          `CSV export truncated: fetched ${allUsers.length} of ${total} candidates (max ${CSV_EXPORT_MAX_PAGES} pages)`,
        )
      }

      const csv = relinkCandidatesToCsv(allUsers)
      return new Response(csv, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="legacy-relink-candidates.csv"',
        },
      })
    }

    const result = await getRelinkCandidates(
      getDb(env),
      Number.isFinite(page) ? page : 1,
      Number.isFinite(pageSize) ? pageSize : 25,
      Number.isFinite(staleDays) ? staleDays : DEFAULT_RELINK_STALE_DAYS,
    )

    return jsonResponse(result, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load relink candidates'
    return jsonResponse({ error: message }, 500, corsHeaders)
  }
}

export async function handleAdminLegacyMigrationSendRelinkEmail(request: Request, env: LegacyMigrationEnv, corsHeaders: Record<string, string>) {
  let actor
  try {
    actor = await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const body = await request.json().catch(() => ({})) as { userIds?: unknown }
  const userIds = Array.isArray(body.userIds)
    ? body.userIds.map((id) => String(id)).filter(Boolean)
    : []

  if (!userIds.length) {
    return jsonResponse({ error: 'userIds is required' }, 400, corsHeaders)
  }

  try {
    const actorUserId = typeof (actor as { sub?: string })?.sub === 'string' ? (actor as { sub: string }).sub : 'system'
    const result = await sendRelinkEmails(getDb(env), env, userIds, actorUserId)
    return jsonResponse({ ok: true, ...result }, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send relink emails'
    return jsonResponse({ error: message, code: 'legacy_relink_email_failed' }, 502, corsHeaders)
  }
}
