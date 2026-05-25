import { requireAuth, requireRole } from './auth.js'

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function buildAdminAuditLogStatement(db: any, {
  actorUserId,
  actionType,
  targetUserId,
  detail,
}: {
  actorUserId: string
  actionType: string
  targetUserId: string
  detail?: Record<string, unknown>
}) {
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

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) return null
  return trimmed
}

const ACTIVE_STATUSES = ['active', 'trialing'] as const

export type TransferSubscriptionErrorCode =
  | 'source_not_found'
  | 'target_not_found'
  | 'target_has_subscription'
  | 'same_user'
  | 'no_active_subscription'
  | 'transfer_failed'
  | 'invalid_email'

export async function executeSubscriptionTransfer(
  db: any,
  {
    sourceUserId,
    targetEmail,
    actorUserId,
  }: {
    sourceUserId: string
    targetEmail: string
    actorUserId: string
  },
): Promise<
  | { ok: true; targetUserId: string; targetEmail: string }
  | { ok: false; code: TransferSubscriptionErrorCode; error: string; status: number }
> {
  const normalizedTargetEmail = normalizeEmail(targetEmail)
  if (!normalizedTargetEmail) {
    return { ok: false, code: 'invalid_email', error: 'Valid targetEmail is required', status: 400 }
  }

  const sourceUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(sourceUserId).first()
  if (!sourceUser) {
    return { ok: false, code: 'source_not_found', error: 'Source user not found', status: 404 }
  }

  const targetUser = await db.prepare('SELECT id, email FROM users WHERE lower(email) = ? LIMIT 1')
    .bind(normalizedTargetEmail)
    .first()

  if (!targetUser) {
    return { ok: false, code: 'target_not_found', error: 'Target account not found', status: 404 }
  }

  if (targetUser.id === sourceUserId) {
    return { ok: false, code: 'same_user', error: 'Cannot transfer subscription to the same account', status: 400 }
  }

  const sourceActive = await db.prepare(`
    SELECT COUNT(*) AS n FROM subscriptions
    WHERE user_id = ? AND status IN ('active', 'trialing')
  `).bind(sourceUserId).first()
  if (Number(sourceActive?.n || 0) === 0) {
    return {
      ok: false,
      code: 'no_active_subscription',
      error: 'Source account has no active or trialing subscription',
      status: 400,
    }
  }

  const targetActive = await db.prepare(`
    SELECT COUNT(*) AS n FROM subscriptions
    WHERE user_id = ? AND status IN ('active', 'trialing')
  `).bind(targetUser.id).first()
  if (Number(targetActive?.n || 0) > 0) {
    return {
      ok: false,
      code: 'target_has_subscription',
      error: 'Target account already has an active or trialing subscription',
      status: 400,
    }
  }

  const transferStmt = db.prepare(`
    UPDATE subscriptions
    SET user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(targetUser.id, sourceUserId)

  const auditStmt = buildAdminAuditLogStatement(db, {
    actorUserId,
    actionType: 'subscription_transfer',
    targetUserId: targetUser.id,
    detail: {
      sourceUserId,
      sourceEmail: sourceUser.email,
      targetEmail: targetUser.email,
    },
  })

  try {
    const [transferResult] = await db.batch([transferStmt, auditStmt])
    if ((transferResult.meta?.changes ?? 0) === 0) {
      return {
        ok: false,
        code: 'no_active_subscription',
        error: 'No subscription rows were transferred',
        status: 400,
      }
    }
  } catch (e) {
    console.error('executeSubscriptionTransfer batch:', e instanceof Error ? e.message : String(e), e)
    return { ok: false, code: 'transfer_failed', error: 'Transfer failed', status: 500 }
  }

  return {
    ok: true,
    targetUserId: targetUser.id,
    targetEmail: targetUser.email,
  }
}

/**
 * POST /api/account/transfer-subscription — authenticated subscriber moves their own rows.
 */
export async function handleAccountTransferSubscription(request: any, env: any, corsHeaders: any) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const targetEmail = typeof body?.targetEmail === 'string' ? body.targetEmail : ''
  if (!targetEmail.trim()) {
    return jsonResponse({ error: 'targetEmail is required', code: 'invalid_email' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const result = await executeSubscriptionTransfer(db, {
    sourceUserId: user.sub,
    targetEmail,
    actorUserId: user.sub,
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error, code: result.code }, result.status, corsHeaders)
  }
  return jsonResponse({ ok: true, targetEmail: result.targetEmail }, 200, corsHeaders)
}

/**
 * POST /api/admin/users/transfer-subscription — admin moves a subscriber's rows to another account.
 */
export async function handleAdminTransferSubscription(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  let actor
  try {
    actor = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const sourceUserId = typeof body?.sourceUserId === 'string' ? body.sourceUserId.trim() : ''
  const targetEmail = typeof body?.targetEmail === 'string' ? body.targetEmail : ''
  if (!sourceUserId) {
    return jsonResponse({ error: 'sourceUserId is required' }, 400, corsHeaders)
  }
  if (!targetEmail.trim()) {
    return jsonResponse({ error: 'targetEmail is required', code: 'invalid_email' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const result = await executeSubscriptionTransfer(db, {
    sourceUserId,
    targetEmail,
    actorUserId: actor.sub,
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error, code: result.code }, result.status, corsHeaders)
  }
  return jsonResponse({ ok: true, targetEmail: result.targetEmail }, 200, corsHeaders)
}

export { ACTIVE_STATUSES }
