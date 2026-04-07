/**
 * packages/api/src/brevo.js
 *
 * Brevo Marketing: sync paying subscribers to a contact list; optional newsletter sends.
 *
 * Requires env.BREVO_API_KEY. List ID and campaign sender are stored in admin_settings:
 *   brevo_subscriber_list_id, brevo_campaign_sender_email, brevo_campaign_sender_name
 */

import { requireRole } from './auth.js'

const BREVO_BASE = 'https://api.brevo.com/v3'

function getDb(env) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

async function getAdminSetting(db, key) {
  const row = await db.prepare('SELECT value FROM admin_settings WHERE key = ?').bind(key).first()
  return row?.value ?? null
}

async function setAdminSetting(db, key, value) {
  await db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run()
}

async function brevoFetch(path, options, env) {
  const key = env.BREVO_API_KEY
  if (!key) {
    return { ok: false, status: 503, json: async () => ({ message: 'BREVO_API_KEY not configured' }) }
  }
  const res = await fetch(`${BREVO_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'api-key': key,
      ...options.headers,
    },
  })
  return res
}

/**
 * Sync newsletter membership from a Stripe subscription status.
 */
export async function syncNewsletterForStripeSubscription(db, userId, stripeStatus, env) {
  const paying = ['active', 'trialing'].includes(stripeStatus)
  if (paying) {
    await syncPayingSubscriberToNewsletter(db, userId, env)
  } else {
    await removeSubscriberFromNewsletter(db, userId, env)
  }
}

/**
 * Add or update a user in the Brevo subscriber list (paying subscribers).
 * No-op if API key or list id is missing.
 */
export async function syncPayingSubscriberToNewsletter(db, userId, env) {
  if (!env.BREVO_API_KEY) return

  const listIdRaw = await getAdminSetting(db, 'brevo_subscriber_list_id')
  const listId = listIdRaw != null && String(listIdRaw).trim() !== '' ? Number.parseInt(String(listIdRaw).trim(), 10) : NaN
  if (!Number.isFinite(listId) || listId <= 0) return

  const row = await db.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(userId).first()
  const email = row?.email ? String(row.email).trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return

  const body = {
    email,
    updateEnabled: true,
    listIds: [listId],
  }

  const res = await brevoFetch('/contacts', { method: 'POST', body: JSON.stringify(body) }, env)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('Brevo sync contact failed:', res.status, err)
  }
}

/**
 * Remove a user's email from the subscriber list (e.g. subscription ended).
 */
export async function removeSubscriberFromNewsletter(db, userId, env) {
  if (!env.BREVO_API_KEY) return

  const listIdRaw = await getAdminSetting(db, 'brevo_subscriber_list_id')
  const listId = listIdRaw != null && String(listIdRaw).trim() !== '' ? Number.parseInt(String(listIdRaw).trim(), 10) : NaN
  if (!Number.isFinite(listId) || listId <= 0) return

  const row = await db.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(userId).first()
  const email = row?.email ? String(row.email).trim().toLowerCase() : ''
  if (!email) return

  const res = await brevoFetch(
    `/contacts/lists/${listId}/contacts/remove`,
    { method: 'POST', body: JSON.stringify({ emails: [email] }) },
    env,
  )
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}))
    console.error('Brevo remove from list failed:', res.status, err)
  }
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

/**
 * GET/PATCH /api/admin/newsletter/settings — admin or super_admin only
 * GET returns current Brevo-related settings (no secrets).
 * PATCH body: { brevoSubscriberListId?, brevoCampaignSenderEmail?, brevoCampaignSenderName? }
 */
export async function handleAdminNewsletterSettings(request, env, corsHeaders) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const db = getDb(env)

  if (request.method === 'GET') {
    const [brevoSubscriberListId, brevoCampaignSenderEmail, brevoCampaignSenderName] = await Promise.all([
      getAdminSetting(db, 'brevo_subscriber_list_id'),
      getAdminSetting(db, 'brevo_campaign_sender_email'),
      getAdminSetting(db, 'brevo_campaign_sender_name'),
    ])
    return jsonResponse({
      brevoSubscriberListId: brevoSubscriberListId ?? '',
      brevoCampaignSenderEmail: brevoCampaignSenderEmail ?? '',
      brevoCampaignSenderName: brevoCampaignSenderName ?? '',
    }, 200, corsHeaders)
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
  }

  if ('brevoSubscriberListId' in body) {
    const v = body.brevoSubscriberListId
    if (v === null || v === '') {
      await setAdminSetting(db, 'brevo_subscriber_list_id', '')
    } else if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      await setAdminSetting(db, 'brevo_subscriber_list_id', String(Math.floor(v)))
    } else if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      await setAdminSetting(db, 'brevo_subscriber_list_id', v.trim())
    } else {
      return jsonResponse({ error: 'brevoSubscriberListId must be a positive integer or empty', code: 'invalid_list_id' }, 400, corsHeaders)
    }
  }

  if ('brevoCampaignSenderEmail' in body) {
    const v = body.brevoCampaignSenderEmail
    if (v === null || v === '') {
      await setAdminSetting(db, 'brevo_campaign_sender_email', '')
    } else if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
        return jsonResponse({ error: 'Invalid brevoCampaignSenderEmail', code: 'invalid_sender_email' }, 400, corsHeaders)
      }
      await setAdminSetting(db, 'brevo_campaign_sender_email', t)
    } else {
      return jsonResponse({ error: 'brevoCampaignSenderEmail must be a string' }, 400, corsHeaders)
    }
  }

  if ('brevoCampaignSenderName' in body) {
    const v = body.brevoCampaignSenderName
    if (v === null || v === '') {
      await setAdminSetting(db, 'brevo_campaign_sender_name', '')
    } else if (typeof v === 'string') {
      await setAdminSetting(db, 'brevo_campaign_sender_name', v.trim().slice(0, 120))
    } else {
      return jsonResponse({ error: 'brevoCampaignSenderName must be a string' }, 400, corsHeaders)
    }
  }

  const [brevoSubscriberListId, brevoCampaignSenderEmail, brevoCampaignSenderName] = await Promise.all([
    getAdminSetting(db, 'brevo_subscriber_list_id'),
    getAdminSetting(db, 'brevo_campaign_sender_email'),
    getAdminSetting(db, 'brevo_campaign_sender_name'),
  ])

  return jsonResponse({
    ok: true,
    brevoSubscriberListId: brevoSubscriberListId ?? '',
    brevoCampaignSenderEmail: brevoCampaignSenderEmail ?? '',
    brevoCampaignSenderName: brevoCampaignSenderName ?? '',
  }, 200, corsHeaders)
}

/**
 * POST /api/admin/newsletter/send — create a classic campaign and send immediately.
 * Body: { subject: string, htmlBody: string }
 */
export async function handleAdminNewsletterSend(request, env, corsHeaders) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  if (!env.BREVO_API_KEY) {
    return jsonResponse({ error: 'Brevo is not configured (missing BREVO_API_KEY)', code: 'brevo_not_configured' }, 503, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const htmlBody = typeof body?.htmlBody === 'string' ? body.htmlBody : ''
  if (!subject || !htmlBody.trim()) {
    return jsonResponse({ error: 'subject and htmlBody are required', code: 'validation' }, 400, corsHeaders)
  }

  const db = getDb(env)
  const listIdRaw = await getAdminSetting(db, 'brevo_subscriber_list_id')
  const listId = listIdRaw != null && String(listIdRaw).trim() !== '' ? Number.parseInt(String(listIdRaw).trim(), 10) : NaN
  if (!Number.isFinite(listId) || listId <= 0) {
    return jsonResponse({
      error: 'Configure brevoSubscriberListId in newsletter settings first',
      code: 'list_not_configured',
    }, 422, corsHeaders)
  }

  const senderEmailRaw = await getAdminSetting(db, 'brevo_campaign_sender_email')
  const senderEmail = senderEmailRaw ? String(senderEmailRaw).trim().toLowerCase() : ''
  if (!senderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    return jsonResponse({
      error: 'Configure a verified brevoCampaignSenderEmail in newsletter settings',
      code: 'sender_not_configured',
    }, 422, corsHeaders)
  }

  const senderNameRaw = await getAdminSetting(db, 'brevo_campaign_sender_name')
  const senderName = senderNameRaw ? String(senderNameRaw).trim() : ''

  const campaignPayload = {
    name: `VMP Newsletter ${new Date().toISOString()}`,
    subject,
    type: 'classic',
    sender: senderName ? { email: senderEmail, name: senderName } : { email: senderEmail },
    htmlContent: htmlBody,
    recipients: { listIds: [listId] },
  }

  const createRes = await brevoFetch('/emailCampaigns', { method: 'POST', body: JSON.stringify(campaignPayload) }, env)
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}))
    console.error('Brevo createEmailCampaign failed:', createRes.status, err)
    return jsonResponse({
      error: typeof err.message === 'string' ? err.message : 'Failed to create email campaign',
      code: 'brevo_campaign_error',
    }, createRes.status >= 400 && createRes.status < 600 ? createRes.status : 502, corsHeaders)
  }

  const created = await createRes.json().catch(() => null)
  const campaignId = created?.id
  if (campaignId == null || !Number.isFinite(Number(campaignId))) {
    return jsonResponse({ error: 'Unexpected response creating campaign', code: 'brevo_campaign_error' }, 502, corsHeaders)
  }

  const sendRes = await brevoFetch(`/emailCampaigns/${campaignId}/sendNow`, { method: 'POST' }, env)
  if (!sendRes.ok && sendRes.status !== 204) {
    const err = await sendRes.json().catch(() => ({}))
    console.error('Brevo sendNow failed:', sendRes.status, err)
    return jsonResponse({
      error: typeof err.message === 'string' ? err.message : 'Campaign created but send failed',
      code: 'brevo_send_failed',
      campaignId,
    }, sendRes.status >= 400 && sendRes.status < 600 ? sendRes.status : 502, corsHeaders)
  }

  return jsonResponse({ ok: true, campaignId: Number(campaignId) }, 200, corsHeaders)
}
