import { NotImplementedError } from '../errors.js'
import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  CreateSubscriptionInput,
  PaymentCustomer,
  PaymentProvider,
  PaymentProviderCapabilities,
  RefundOptions,
  Subscription,
} from '../types.js'

const STUB_CAPABILITIES: PaymentProviderCapabilities = {
  newSubscriptions: false,
  migrationOnly: false,
  recurringPayments: false,
  refunds: false,
  webhooks: false,
}

function stubProvider(id: 'gopay' | 'comgate', label: string): PaymentProvider {
  const message = `${label} support is not yet implemented`
  const throwNI = () => {
    throw new NotImplementedError(message)
  }
  return {
    id,
    capabilities: STUB_CAPABILITIES,
    isConfigured: () => false,
    createCheckoutSession: async () => throwNI(),
    createSubscription: async () => throwNI(),
    cancelSubscription: async () => throwNI(),
    getCustomer: async () => throwNI(),
    refund: async () => throwNI(),
    verifyWebhookSignature: () => throwNI(),
    handleWebhook: async () => throwNI(),
  }
}

export function createGoPayProvider(_config: unknown): PaymentProvider {
  return stubProvider('gopay', 'GoPay')
}

export function createComgateProvider(_config: unknown): PaymentProvider {
  return stubProvider('comgate', 'Comgate')
}
