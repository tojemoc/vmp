import type { ManageSubscriptionInput, PaymentProvider, QerkoPaymentsConfig } from '../../types.js';

export function createQerkoProvider(config: QerkoPaymentsConfig): PaymentProvider {
  return {
    id: 'qerko',
    capabilities: {
      // When enabled in admin settings, Qerko supports brand-new checkouts
      // (initial payment / CardOnFile create) as well as migrated relinks.
      newSubscriptions: true,
      migrationOnly: false,
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
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
      return config.verifyWebhook(body, signatureHeader || null);
    },

    handleWebhook(rawBody) {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
      return config.parseWebhook(body);
    },

    async getManageUrl(input) {
      if (!config.getManageUrl) return null;
      return config.getManageUrl(input);
    },
  };
}
