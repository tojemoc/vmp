/**
 * Payment provider composition root — wires @vmp/payments registry to Worker env + legacy modules.
 */

import {
  createEnabledProviders,
  getRunnableProviderIds,
  normalizeProviderId,
  parseProviderIdList,
  providerIdToDbProvider,
  type PaymentProviderId,
  type PaymentsConfig,
  type PlanType,
} from '@vmp/payments'
import { getSetting } from './settingsStore.js'
import {
  isLegacyProviderConfigured,
  verifyLegacyWebhookSignature,
} from './legacyProvider.js'
import { startLegacyCheckout } from './legacyPayments.js'

const ALL_PROVIDER_IDS: PaymentProviderId[] = ['stripe', 'qerko', 'gopay', 'comgate']
const DEFAULT_ENABLED: PaymentProviderId[] = ['stripe']

async function priceIdForPlan(env: any, planType: PlanType): Promise<string | null> {
  const stored = await getSetting(env, `stripe_price_${planType}`, { ttlSeconds: 300 })
  const value = String(stored ?? '').trim()
  return value || null
}

export function buildPaymentsConfig(env: any): PaymentsConfig {
  return {
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      frontendUrl: env.FRONTEND_URL,
      priceIdForPlan: (planType) => priceIdForPlan(env, planType),
    },
    qerko: {
      isConfigured: () => isLegacyProviderConfigured(env),
      createCheckout: async (input) => {
        const corsHeaders: Record<string, string> = {}
        const response = await startLegacyCheckout(
          env,
          { sub: input.userId, email: input.email },
          {
            planType: input.planType,
            returnPath: input.returnPath,
            purchaseId: input.purchaseId,
          },
          corsHeaders,
        )
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>
        if (!response.ok) {
          const err = new Error(String(payload.error ?? 'Legacy checkout failed'))
          Object.assign(err, { code: payload.code, status: response.status })
          throw err
        }
        return {
          provider: 'qerko' as const,
          ...(typeof payload.checkoutUrl === 'string' ? { checkoutUrl: payload.checkoutUrl } : {}),
          ...(typeof payload.orderId === 'string' ? { orderId: payload.orderId } : {}),
        }
      },
      verifyWebhook: (rawBody, signatureHeader) => verifyLegacyWebhookSignature(env, rawBody, signatureHeader),
      parseWebhook: async (rawBody) => {
        const payload = rawBody ? JSON.parse(rawBody) : {}
        const purchaseId = String(payload.purchaseId ?? payload.purchase_id ?? '').trim()
        return {
          type: 'subscription.updated',
          providerId: 'qerko',
          purchaseId,
          providerOrderId: String(payload.idOrder ?? payload.orderId ?? purchaseId).trim(),
          planType: String(payload.planType ?? 'monthly') as PlanType,
          status: String(payload.status ?? payload.subscriptionStatus ?? ''),
          currentPeriodEnd: payload.currentPeriodEnd ?? payload.current_period_end ?? null,
          raw: payload,
        }
      },
      cancelSubscription: async () => {
        throw new Error('Qerko subscription cancellation is managed in the legacy eshop portal')
      },
      getCustomer: async (customerId) => ({ id: customerId }),
      refund: async () => {
        throw new Error('Qerko refunds are not implemented in VMP')
      },
      createSubscription: async () => {
        throw new Error('Direct Qerko subscription creation is not supported')
      },
    },
  }
}

export async function getConfiguredProviderIds(env: any): Promise<PaymentProviderId[]> {
  const stored = await getSetting(env, 'payments_enabled_providers', { defaultValue: 'stripe' })
  const parsed = parseProviderIdList(stored ?? 'stripe', ALL_PROVIDER_IDS)
  return parsed.length > 0 ? parsed : DEFAULT_ENABLED
}

export async function getPaymentProviderOrder(env: any): Promise<PaymentProviderId[]> {
  const stored = await getSetting(env, 'payment_provider_order', { defaultValue: 'stripe,legacy' })
  const parsed = parseProviderIdList(stored ?? 'stripe,legacy', ALL_PROVIDER_IDS)
  return parsed.length > 0 ? parsed : DEFAULT_ENABLED
}

export async function getPaymentProviders(env: any) {
  const enabled = await getConfiguredProviderIds(env)
  const config = buildPaymentsConfig(env)
  const providers = createEnabledProviders(enabled, config)
  const runnable = getRunnableProviderIds(providers)
  return { providers, enabled, runnable }
}

export function toApiProviderId(id: PaymentProviderId): 'stripe' | 'legacy' {
  return id === 'qerko' ? 'legacy' : 'stripe'
}

export function fromApiProviderId(raw: string): PaymentProviderId | null {
  return normalizeProviderId(raw)
}

export { providerIdToDbProvider }
