import { NotImplementedError } from '../errors.js';
import type { PaymentProvider, PaymentProviderCapabilities } from '../types.js';

const STUB_CAPABILITIES: PaymentProviderCapabilities = {
  newSubscriptions: false,
  migrationOnly: false,
  recurringPayments: false,
  refunds: false,
  webhooks: false,
};

/** Comgate remains stub-only until a dedicated adapter lands (see #442). */
export function createComgateProvider(_config: unknown): PaymentProvider {
  const message = 'Comgate support is not yet implemented';
  const throwNI = () => {
    throw new NotImplementedError(message);
  };
  return {
    id: 'comgate',
    capabilities: STUB_CAPABILITIES,
    isConfigured: () => false,
    createCheckoutSession: async () => throwNI(),
    createSubscription: async () => throwNI(),
    cancelSubscription: async () => throwNI(),
    getCustomer: async () => throwNI(),
    refund: async () => throwNI(),
    verifyWebhookSignature: () => throwNI(),
    handleWebhook: async () => throwNI(),
  };
}
