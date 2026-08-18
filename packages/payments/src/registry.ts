import type { PaymentProviderId } from './ids.js';
import { createComgateProvider } from './providers/comgate/index.js';
import { createGoPayProvider } from './providers/gopay/index.js';
import { createQerkoProvider } from './providers/qerko/index.js';
import { createStripeProvider } from './providers/stripe/index.js';
import type { PaymentProvider, PaymentsConfig } from './types.js';

export const PROVIDER_FACTORIES: Record<PaymentProviderId, (config: unknown) => PaymentProvider> = {
  stripe: (config) => createStripeProvider(config as PaymentsConfig['stripe'] & object),
  qerko: (config) => createQerkoProvider(config as PaymentsConfig['qerko'] & object),
  gopay: (config) => createGoPayProvider(config as PaymentsConfig['gopay'] & object),
  comgate: (config) => createComgateProvider(config as PaymentsConfig['comgate'] & object),
};

export function createEnabledProviders(
  enabledIds: PaymentProviderId[],
  config: PaymentsConfig,
): Map<PaymentProviderId, PaymentProvider> {
  const providers = new Map<PaymentProviderId, PaymentProvider>();
  for (const id of enabledIds) {
    const factory = PROVIDER_FACTORIES[id];
    if (!factory) continue;
    if (id === 'stripe') {
      if (!config.stripe) continue;
      providers.set(id, factory(config.stripe));
    } else if (id === 'qerko') {
      if (!config.qerko) continue;
      providers.set(id, factory(config.qerko));
    } else if (id === 'gopay') {
      if (!config.gopay) continue;
      providers.set(id, factory(config.gopay));
    } else if (id === 'comgate') {
      if (!config.comgate) continue;
      providers.set(id, factory(config.comgate));
    } else {
      providers.set(id, factory(undefined));
    }
  }
  return providers;
}

export function getRunnableProviderIds(
  providers: Map<PaymentProviderId, PaymentProvider>,
): PaymentProviderId[] {
  return [...providers.entries()]
    .filter(([, provider]) => provider.isConfigured())
    .map(([id]) => id);
}
