export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}

export type PaymentProviderId = 'stripe' | 'qerko' | 'gopay' | 'comgate'

/** Admin settings / API may still use `legacy` — maps to Qerko. */
export const PROVIDER_ID_ALIASES: Record<string, PaymentProviderId> = {
  stripe: 'stripe',
  legacy: 'qerko',
  qerko: 'qerko',
  gopay: 'gopay',
  comgate: 'comgate',
}

export function normalizeProviderId(raw: string): PaymentProviderId | null {
  const id = String(raw ?? '').trim().toLowerCase()
  return PROVIDER_ID_ALIASES[id] ?? null
}

export function parseProviderIdList(raw: unknown, allowed: PaymentProviderId[]): PaymentProviderId[] {
  const values = Array.isArray(raw)
    ? raw.map((v) => String(v).trim().toLowerCase())
    : String(raw ?? '').split(',').map((v) => v.trim().toLowerCase())
  const out: PaymentProviderId[] = []
  for (const value of values) {
    const id = normalizeProviderId(value)
    if (id && allowed.includes(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** DB `subscriptions.provider` column value for a registry provider. */
export function providerIdToDbProvider(id: PaymentProviderId): string {
  return id === 'qerko' ? 'legacy' : id
}

export function dbProviderToProviderId(dbProvider: string): PaymentProviderId {
  const normalized = normalizeProviderId(dbProvider)
  return normalized ?? 'stripe'
}
