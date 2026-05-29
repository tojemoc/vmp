type PlanType = 'monthly' | 'yearly' | 'club'
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled'

export const GOCARDLESS_DEFAULT_CURRENCY = 'EUR'

/** Normalise admin `gocardless_currency` (or env default) to a 3-letter ISO code. */
export function normalizeGoCardlessCurrency(raw: unknown): string {
  const currency = String(raw ?? GOCARDLESS_DEFAULT_CURRENCY).trim().toUpperCase()
  return /^[A-Z]{3}$/.test(currency) ? currency : GOCARDLESS_DEFAULT_CURRENCY
}

const GOCARDLESS_METADATA_MAX_KEYS = 3

export function buildGoCardlessMandateBillingRequestPayload(params: {
  currency: string
  metadata: Record<string, string>
  creditorId?: string
}) {
  const metadataKeys = Object.keys(params.metadata)
  if (metadataKeys.length > GOCARDLESS_METADATA_MAX_KEYS) {
    throw new Error(
      `GoCardless billing_requests metadata allows at most ${GOCARDLESS_METADATA_MAX_KEYS} keys; got ${metadataKeys.length}: ${metadataKeys.join(', ')}`,
    )
  }
  const billing_requests: Record<string, unknown> = {
    mandate_request: { currency: params.currency },
    metadata: params.metadata,
  }
  const creditorId = String(params.creditorId ?? '').trim()
  if (creditorId) {
    billing_requests.links = { creditor: creditorId }
  }
  return { billing_requests }
}

export function buildGoCardlessBillingRequestFlowCreatePayload(params: {
  billingRequestId: string
  redirectUri: string
  exitUri: string
  customerEmail?: string
}) {
  const billing_request_flows: Record<string, unknown> = {
    auto_fulfil: true,
    redirect_uri: params.redirectUri,
    exit_uri: params.exitUri,
    lock_currency: true,
    links: {
      billing_request: params.billingRequestId,
    },
  }
  const email = String(params.customerEmail ?? '').trim()
  if (email) {
    billing_request_flows.prefilled_customer = { email }
  }
  return { billing_request_flows }
}

export function formatGoCardlessApiError(response: any, fallback: string): string {
  const errors = Array.isArray(response?.data?.error?.errors) ? response.data.error.errors : []
  if (!errors.length) return fallback
  const first = errors[0] ?? {}
  const reason = typeof first.reason === 'string' ? first.reason.trim() : ''
  const field = typeof first.field === 'string' ? first.field.trim() : ''
  if (reason === 'currency_doesnt_support_functionality') {
    return 'GoCardless bank debit checkout is not available for the configured currency. '
      + 'Set admin setting gocardless_currency to EUR for SEPA, or enable the currency on your GoCardless creditor.'
  }
  const message = typeof first.message === 'string' ? first.message.trim() : ''
  if (field === 'metadata' && message.includes('3 properties')) {
    return 'GoCardless checkout metadata is misconfigured (too many fields). Please try again or contact support.'
  }
  if (reason && field) return `${fallback} (${field}: ${reason})`
  if (reason) return `${fallback} (${reason})`
  return fallback
}

async function gocardlessFetch(
  path: string,
  method: string,
  payload: unknown,
  env: any,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`https://api.gocardless.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GOCARDLESS_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'GoCardless-Version': '2015-07-06',
        ...(extraHeaders ?? {}),
      },
      body: payload == null ? null : JSON.stringify(payload),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: json }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const err = new Error('GoCardless request timed out')
      Object.assign(err, { status: 504, code: 'gocardless_timeout' })
      throw err
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function gocardlessPost(
  path: string,
  payload: unknown,
  env: any,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  return gocardlessFetch(path, 'POST', payload, env, extraHeaders)
}

export async function gocardlessGet(path: string, env: any): Promise<any> {
  return gocardlessFetch(path, 'GET', null, env)
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyGoCardlessWebhook(rawBody: string, sigHeader: string, secret: string) {
  if (!sigHeader || !secret) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const bytes = new Uint8Array(digest)
  const expectedHex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  const expectedBase64 = btoa(String.fromCharCode(...bytes))
  const candidate = sigHeader.trim()
  return constantTimeEqual(candidate, expectedHex) || constantTimeEqual(candidate, expectedBase64)
}

export function normalizeGoCardlessStatus(status: string): SubscriptionStatus {
  const normalized = String(status ?? '').trim().toLowerCase()
  const statusMap: Record<string, SubscriptionStatus> = {
    active: 'active',
    customer_approval_granted: 'active',
    pending_customer_approval: 'trialing',
    submitted: 'trialing',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    finished: 'cancelled',
    failed: 'past_due',
    late_failure_settled: 'past_due',
  }
  return statusMap[normalized] ?? 'cancelled'
}

export function getGoCardlessInterval(planType: PlanType): { interval: number, intervalUnit: 'monthly' | 'yearly' } {
  if (planType === 'monthly') return { interval: 1, intervalUnit: 'monthly' }
  return { interval: 1, intervalUnit: 'yearly' }
}

/** Mandate id after a billing request is fulfilled (hosted flow or manual fulfil). */
export function extractMandateIdFromBillingRequest(billingRequest: any): string {
  return String(
    billingRequest?.mandate_request?.links?.mandate
    ?? billingRequest?.links?.mandate
    ?? '',
  ).trim()
}

/**
 * Load a billing request and ensure its mandate exists (fulfil when ready_to_fulfil).
 * Used after the customer returns from a Billing Request Flow authorisation URL.
 */
export async function resolveFulfilledBillingRequestMandate(
  billingRequestId: string,
  env: any,
  idempotencyKey?: string,
): Promise<{ ok: true, billingRequest: any, mandateId: string } | { ok: false, billingRequest?: any, reason: string }> {
  const lookup = await gocardlessGet(`/billing_requests/${billingRequestId}`, env)
  let billingRequest = lookup?.data?.billing_requests
  if (!lookup.ok || !billingRequest?.id) {
    return { ok: false, reason: 'lookup_failed' }
  }

  let status = String(billingRequest.status ?? '').trim().toLowerCase()
  if (status === 'ready_to_fulfil') {
    const fulfil = await gocardlessPost(
      `/billing_requests/${billingRequestId}/actions/fulfil`,
      {},
      env,
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    )
    billingRequest = fulfil?.data?.billing_requests ?? billingRequest
    if (!fulfil.ok) {
      return { ok: false, billingRequest, reason: 'fulfil_failed' }
    }
    status = String(billingRequest.status ?? '').trim().toLowerCase()
  }

  const mandateId = extractMandateIdFromBillingRequest(billingRequest)
  if (!mandateId || status !== 'fulfilled') {
    return { ok: false, billingRequest, reason: 'mandate_not_ready' }
  }

  return { ok: true, billingRequest, mandateId }
}
