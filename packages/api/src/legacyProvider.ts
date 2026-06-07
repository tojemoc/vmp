/**
 * Legacy eshop billing provider (API base URL from LEGACY_ESHOP_API_URL env var).
 */

type LegacyEnv = {
  LEGACY_ESHOP_API_URL?: string
  LEGACY_ESHOP_MERCHANT_ID?: string
  LEGACY_ESHOP_API_KEY?: string
  LEGACY_ESHOP_WEBHOOK_SECRET?: string
  LEGACY_ESHOP_FETCH_TIMEOUT_MS?: string
}

const DEFAULT_LEGACY_FETCH_TIMEOUT_MS = 5000

function legacyFetchTimeoutMs(env: LegacyEnv): number {
  const raw = env.LEGACY_ESHOP_FETCH_TIMEOUT_MS
  const parsed = raw != null && String(raw).trim() !== '' ? Number.parseInt(String(raw).trim(), 10) : DEFAULT_LEGACY_FETCH_TIMEOUT_MS
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120_000) : DEFAULT_LEGACY_FETCH_TIMEOUT_MS
}

export function isLegacyFetchTimeout(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'legacy_timeout')
}

async function legacyFetch(
  env: LegacyEnv,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutMs = legacyFetchTimeoutMs(env)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const timeoutErr = new Error('Legacy billing API request timed out')
      Object.assign(timeoutErr, { code: 'legacy_timeout' })
      throw timeoutErr
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

export function getLegacyApiBase(env: LegacyEnv): string {
  return trimTrailingSlashes(String(env.LEGACY_ESHOP_API_URL ?? '').trim())
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
  const response = await legacyFetch(env, url, {
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
  const response = await legacyFetch(env, url, {
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
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  return verifyLegacyWebhookSignatureAsync(env, rawBody, signatureHeader)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

function bytesToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyLegacyWebhookSignatureAsync(
  env: LegacyEnv,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = String(env.LEGACY_ESHOP_WEBHOOK_SECRET ?? '').trim()
  if (!secret || !signatureHeader) return false

  const provided = signatureHeader.trim()
  const stripped = provided.replace(/^sha256=/i, '')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = bytesToHex(digest)

  if (timingSafeEqual(provided, hex) || timingSafeEqual(stripped, hex)) return true
  if (timingSafeEqual(provided, secret) || timingSafeEqual(stripped, secret)) return true
  return false
}

export function normalizeLegacySubscriptionStatus(raw: unknown): 'active' | 'trialing' | 'past_due' | 'cancelled' {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'active' || value === 'paid' || value === 'completed') return 'active'
  if (value === 'trialing' || value === 'trial') return 'trialing'
  if (value === 'past_due' || value === 'overdue') return 'past_due'
  return 'cancelled'
}
