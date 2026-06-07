/**
 * Legacy eshop billing provider (API base URL from LEGACY_ESHOP_API_URL env var).
 */

type LegacyEnv = {
  LEGACY_ESHOP_API_URL?: string
  LEGACY_ESHOP_MERCHANT_ID?: string
  LEGACY_ESHOP_API_KEY?: string
  LEGACY_ESHOP_WEBHOOK_SECRET?: string
}

export function getLegacyApiBase(env: LegacyEnv): string {
  return String(env.LEGACY_ESHOP_API_URL ?? '').trim().replace(/\/+$/, '')
}

export function isLegacyProviderConfigured(env: LegacyEnv): boolean {
  return Boolean(
    getLegacyApiBase(env) &&
    String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim() &&
    String(env.LEGACY_ESHOP_API_KEY ?? '').trim(),
  )
}

function legacyHeaders(env: LegacyEnv): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${String(env.LEGACY_ESHOP_API_KEY ?? '').trim()}`,
  }
}

export async function legacyPost<T = Record<string, unknown>>(
  env: LegacyEnv,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const base = getLegacyApiBase(env)
  if (!base) throw new Error('Legacy billing API is not configured')

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, {
    method: 'POST',
    headers: legacyHeaders(env),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: T
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Legacy billing API returned invalid JSON (${response.status})`)
  }
  if (!response.ok) {
    const message = typeof (parsed as any)?.error === 'string'
      ? (parsed as any).error
      : `Legacy billing API error (${response.status})`
    throw new Error(message)
  }
  return parsed
}

export async function legacyGet<T = Record<string, unknown>>(
  env: LegacyEnv,
  path: string,
): Promise<T> {
  const base = getLegacyApiBase(env)
  if (!base) throw new Error('Legacy billing API is not configured')

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, {
    method: 'GET',
    headers: legacyHeaders(env),
  })
  const text = await response.text()
  let parsed: T
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Legacy billing API returned invalid JSON (${response.status})`)
  }
  if (!response.ok) {
    const message = typeof (parsed as any)?.error === 'string'
      ? (parsed as any).error
      : `Legacy billing API error (${response.status})`
    throw new Error(message)
  }
  return parsed
}

export type LegacyCreateOrderInput = {
  idOrder: string
  purchaseId: string
  email: string
  planType: string
  amountMinor: number
  currency: string
  returnUrl: string
}

export async function createLegacyOrder(env: LegacyEnv, input: LegacyCreateOrderInput) {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  return legacyPost(env, '/order', {
    idMerchant,
    idOrder: input.idOrder,
    purchaseId: input.purchaseId,
    customerEmail: input.email,
    planType: input.planType,
    amount: input.amountMinor,
    currency: input.currency,
    returnUrl: input.returnUrl,
  })
}

export async function processLegacyOrder(env: LegacyEnv, idOrder: string) {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  return legacyPost(env, '/order/process', { idMerchant, idOrder })
}

export async function getLegacyOrder(env: LegacyEnv, idOrder: string) {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  return legacyGet(env, `/order/${encodeURIComponent(idMerchant)}/${encodeURIComponent(idOrder)}`)
}

export function verifyLegacyWebhookSignature(
  env: LegacyEnv,
  _rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = String(env.LEGACY_ESHOP_WEBHOOK_SECRET ?? '').trim()
  if (!secret) return false
  if (!signatureHeader) return false
  return signatureHeader.trim() === secret || signatureHeader.trim() === `sha256=${secret}`
}

export function normalizeLegacySubscriptionStatus(raw: unknown): 'active' | 'trialing' | 'past_due' | 'cancelled' {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'active' || value === 'paid' || value === 'completed') return 'active'
  if (value === 'trialing' || value === 'trial') return 'trialing'
  if (value === 'past_due' || value === 'overdue') return 'past_due'
  return 'cancelled'
}
