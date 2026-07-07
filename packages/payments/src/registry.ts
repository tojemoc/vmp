import { createComgateProvider, createGoPayProvider } from './providers/stubs.js'
import { createQerkoProvider } from './providers/qerko/index.js'
import { createStripeProvider } from './providers/stripe/index.js'
import type { PaymentProviderId } from './ids.js'
import type { PaymentsConfig, PaymentProvider } from './types.js'

export const PROVIDER_FACTORIES: Record<PaymentProviderId, (config: unknown) => PaymentProvider> = {
  stripe: (config) => createStripeProvider(config as PaymentsConfig['stripe'] & object),
  qerko: (config) => createQerkoProvider(config as PaymentsConfig['qerko'] & object),
  gopay: createGoPayProvider,
  comgate: createComgateProvider,
}

export function createEnabledProviders(
  enabledIds: PaymentProviderId[],
  config: PaymentsConfig,
): Map<PaymentProviderId, PaymentProvider> {
  const providers = new Map<PaymentProviderId, PaymentProvider>()
  for (const id of enabledIds) {
    const factory = PROVIDER_FACTORIES[id]
    if (!factory) continue
    const providerConfig = id === 'stripe'
      ? config.stripe
      : id === 'qerko'
        ? config.qerko
        : undefined
    if (id === 'stripe' || id === 'qerko') {
      if (!providerConfig) continue
      providers.set(id, factory(providerConfig))
    } else {
      providers.set(id, factory(undefined))
    }
  }
  return providers
}

export function getRunnableProviderIds(providers: Map<PaymentProviderId, PaymentProvider>): PaymentProviderId[] {
  return [...providers.entries()]
    .filter(([, provider]) => provider.isConfigured())
    .map(([id]) => id)
}
