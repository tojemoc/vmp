import type {
  PaymentProvider,
  QerkoPaymentsConfig,
} from '../../types.js'

export function createQerkoProvider(config: QerkoPaymentsConfig): PaymentProvider {
  return {
    id: 'qerko',
    capabilities: {
      newSubscriptions: false,
      migrationOnly: true,
      recurringPayments: true,
      refunds: true,
      webhooks: true,
    },
    isConfigured: () => config.isConfigured(),

    createCheckoutSession: (input) => config.createCheckout(input),
    createSubscription: (input) => config.createSubscription(input),
    cancelSubscription: (subscriptionId) => config.cancelSubscription(subscriptionId),
    getCustomer: (customerId) => config.getCustomer(customerId),
    refund: (paymentId, opts) => config.refund(paymentId, opts),

    verifyWebhookSignature(rawBody, signatureHeader) {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody)
      return config.verifyWebhook(body, signatureHeader || null)
    },

    handleWebhook(rawBody) {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody)
      return config.parseWebhook(body)
    },
  }
}
