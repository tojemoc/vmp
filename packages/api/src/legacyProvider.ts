/**
 * Legacy eshop billing provider (Qerko E-shop API v2).
 *
 * API base URL from LEGACY_ESHOP_API_URL (production) or LEGACY_ESHOP_SANDBOX_API_URL (testing).
 */

export type LegacyEnv = {
  LEGACY_ESHOP_API_URL?: string
  LEGACY_ESHOP_SANDBOX_API_URL?: string
  LEGACY_ESHOP_MERCHANT_ID?: string
  LEGACY_ESHOP_API_KEY?: string
  LEGACY_ESHOP_WEBHOOK_SECRET?: string
  LEGACY_ESHOP_FETCH_TIMEOUT_MS?: string
  FRONTEND_URL?: string
  API_URL?: string
}

const DEFAULT_LEGACY_FETCH_TIMEOUT_MS = 5000
const DEFAULT_API_URL = 'https://vmp-api.tjm.sk'

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

export function getLegacySandboxApiBase(env: LegacyEnv): string {
  return trimTrailingSlashes(String(env.LEGACY_ESHOP_SANDBOX_API_URL ?? '').trim())
}

export function isLegacySandboxConfigured(env: LegacyEnv): boolean {
  return Boolean(getLegacySandboxApiBase(env))
}

export function getLegacyValidationApiBase(env: LegacyEnv, target: 'sandbox' | 'production'): string {
  if (target === 'sandbox') {
    const sandbox = getLegacySandboxApiBase(env)
    if (!sandbox) throw new Error('LEGACY_ESHOP_SANDBOX_API_URL is not configured')
    return sandbox
  }
  const production = getLegacyApiBase(env)
  if (!production) throw new Error('LEGACY_ESHOP_API_URL is not configured')
  return production
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

export type LegacyPostResult<T = Record<string, unknown>> = {
  ok: boolean
  status: number
  parsed: T
  text: string
}

export async function legacyPostRaw<T = Record<string, unknown>>(
  env: LegacyEnv,
  base: string,
  path: string,
  body: Record<string, unknown>,
): Promise<LegacyPostResult<T>> {
  const apiBase = trimTrailingSlashes(base)
  if (!apiBase) throw new Error('Legacy billing API is not configured')

  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`
  const response = await legacyFetch(env, url, {
    method: 'POST',
    headers: legacyHeaders(env),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: T
  try {
    parsed = text ? JSON.parse(text) as T : {} as T
  } catch {
    throw new Error(`Legacy billing API returned invalid JSON (${response.status})`)
  }
  return { ok: response.ok, status: response.status, parsed, text }
}

async function legacyPost<T = Record<string, unknown>>(
  env: LegacyEnv,
  base: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const result = await legacyPostRaw<T>(env, base, path, body)
  if (!result.ok) {
    const message = typeof (result.parsed as { message?: string })?.message === 'string'
      ? (result.parsed as { message: string }).message
      : typeof (result.parsed as { error?: string })?.error === 'string'
        ? (result.parsed as { error: string }).error
        : `Legacy billing API error (${result.status})`
    throw new Error(message)
  }
  return result.parsed
}

export async function legacyGet<T = Record<string, unknown>>(
  env: LegacyEnv,
  base: string,
  path: string,
): Promise<T> {
  const apiBase = trimTrailingSlashes(base)
  if (!apiBase) throw new Error('Legacy billing API is not configured')

  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`
  const response = await legacyFetch(env, url, {
    method: 'GET',
    headers: legacyHeaders(env),
  })
  const text = await response.text()
  let parsed: T
  try {
    parsed = text ? JSON.parse(text) as T : {} as T
  } catch {
    throw new Error(`Legacy billing API returned invalid JSON (${response.status})`)
  }
  if (!response.ok) {
    const message = typeof (parsed as { message?: string })?.message === 'string'
      ? (parsed as { message: string }).message
      : typeof (parsed as { error?: string })?.error === 'string'
        ? (parsed as { error: string }).error
        : `Legacy billing API error (${response.status})`
    throw new Error(message)
  }
  return parsed
}

export function mapPlanTypeToSubscriptionType(planType: string): 'monthly' | 'yearly' {
  const plan = String(planType ?? '').trim().toLowerCase()
  if (plan === 'yearly' || plan === 'club') return 'yearly'
  return 'monthly'
}

export function formatLegacyBillPrice(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2)
}

export function getLegacyNotifyUrl(env: LegacyEnv): string {
  const apiBase = trimTrailingSlashes(String(env.API_URL ?? DEFAULT_API_URL).trim())
  return `${apiBase}/api/payments/webhook/legacy`
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

export function buildLegacyOrderBody(env: LegacyEnv, input: LegacyCreateOrderInput): Record<string, unknown> {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  const returnUrl = String(input.returnUrl ?? '').trim()
  const successUrl = returnUrl.includes('legacy=')
    ? returnUrl
    : `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}legacy=success`
  const failUrl = returnUrl.includes('legacy=')
    ? returnUrl.replace('legacy=success', 'legacy=fail')
    : `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}legacy=fail`

  return {
    idMerchant,
    idOrder: input.idOrder,
    customerEmail: input.email,
    successUrl,
    failUrl,
    notifyUrl: getLegacyNotifyUrl(env),
    cardOnFile: input.purchaseId,
    bill: {
      id: `bill-${input.idOrder}`,
      currency: input.currency,
      subscriptionType: mapPlanTypeToSubscriptionType(input.planType),
      subscriptionPeriodSize: 1,
      items: [
        {
          name: `VMP ${input.planType}`,
          price: formatLegacyBillPrice(input.amountMinor),
          quantity: '1',
        },
      ],
    },
  }
}

export async function createLegacyOrder(env: LegacyEnv, input: LegacyCreateOrderInput) {
  const base = getLegacyApiBase(env)
  return legacyPost(env, base, '/order', buildLegacyOrderBody(env, input))
}

export type LegacyValidationProbeInput = {
  purchaseId: string
  idOrder: string
  email?: string
  planType?: string
  amountMinor?: number
  currency?: string
}

export type LegacyValidationProbeResult = {
  result: 'valid' | 'invalid' | 'error'
  httpStatus?: number
  errorMessage?: string
  reason?: string | null
}

export function interpretLegacyValidationResponse(
  status: number,
  parsed: Record<string, unknown>,
): LegacyValidationProbeResult {
  if (status >= 200 && status < 300) {
    return { result: 'valid', httpStatus: status }
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : null
  const message = typeof parsed.message === 'string' ? parsed.message : `HTTP ${status}`
  const combined = `${message} ${reason ?? ''}`.toLowerCase()
  if (
    status === 400 &&
  (reason === 'cardOnFile' ||
    combined.includes('cardonfile') ||
    combined.includes('not found') ||
    combined.includes('unknown') ||
    combined.includes('invalid'))
  ) {
    return { result: 'invalid', httpStatus: status, errorMessage: message, reason }
  }
  return { result: 'error', httpStatus: status, errorMessage: message, reason }
}

export async function probeLegacyCardOnFile(
  env: LegacyEnv,
  base: string,
  input: LegacyValidationProbeInput,
): Promise<LegacyValidationProbeResult> {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  const frontendUrl = String(env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const amountMinor = input.amountMinor ?? 100
  const body = {
    idMerchant,
    idOrder: input.idOrder,
    customerEmail: input.email ?? 'migration-validation@example.com',
    successUrl: `${frontendUrl}/account?legacy=success&probe=${encodeURIComponent(input.idOrder)}`,
    failUrl: `${frontendUrl}/account?legacy=fail&probe=${encodeURIComponent(input.idOrder)}`,
    notifyUrl: getLegacyNotifyUrl(env),
    cardOnFile: input.purchaseId,
    bill: {
      id: `probe-${input.idOrder}`,
      currency: input.currency ?? 'EUR',
      subscriptionType: mapPlanTypeToSubscriptionType(input.planType ?? 'monthly'),
      subscriptionPeriodSize: 1,
      items: [
        {
          name: 'Migration validation probe',
          price: formatLegacyBillPrice(amountMinor),
          quantity: '1',
        },
      ],
    },
  }

  try {
    const response = await legacyPostRaw(env, base, '/order', body)
    return interpretLegacyValidationResponse(
      response.status,
      response.parsed as Record<string, unknown>,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Legacy validation probe failed'
    if (isLegacyFetchTimeout(err)) {
      return { result: 'error', errorMessage: message }
    }
    return { result: 'error', errorMessage: message }
  }
}

export async function processLegacyOrder(env: LegacyEnv, idOrder: string) {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  const base = getLegacyApiBase(env)
  return legacyPost(env, base, '/order/process', { idMerchant, idOrder })
}

export async function getLegacyOrder(env: LegacyEnv, idOrder: string) {
  const idMerchant = String(env.LEGACY_ESHOP_MERCHANT_ID ?? '').trim()
  const base = getLegacyApiBase(env)
  return legacyGet(env, base, `/order/${encodeURIComponent(idMerchant)}/${encodeURIComponent(idOrder)}`)
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
