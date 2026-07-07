import type { PaymentProviderId } from './ids.js'

export interface PaymentProviderCapabilities {
  newSubscriptions: boolean
  migrationOnly: boolean
  recurringPayments: boolean
  refunds: boolean
  webhooks: boolean
}

export type PlanType = 'monthly' | 'yearly' | 'club'

export interface PaymentCustomer {
  id: string
  email?: string | null
}

export interface CheckoutSession {
  provider: PaymentProviderId
  clientSecret?: string
  checkoutUrl?: string
  orderId?: string
  metadata?: Record<string, string>
}

export interface Subscription {
  id: string
  customerId?: string | null
  status: string
  planType?: PlanType
  currentPeriodEnd?: string | null
}

export interface CreateCheckoutSessionInput {
  userId: string
  email: string
  planType: PlanType
  returnPath: string
  purchaseId?: string
  promo?: {
    stripeCouponId?: string
    metadata?: Record<string, string>
  }
}

export interface CreateSubscriptionInput {
  userId: string
  planType: PlanType
  customerId?: string
}

export interface RefundOptions {
  amountMinor?: number
  reason?: string
}

export type NormalizedPaymentEventType =
  | 'checkout.completed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'subscription.past_due'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'invoice.paid'
  | 'unknown'

export interface NormalizedPaymentEvent {
  type: NormalizedPaymentEventType
  providerId: PaymentProviderId
  userId?: string
  planType?: PlanType
  subscriptionId?: string
  customerId?: string
  purchaseId?: string
  providerOrderId?: string
  status?: string
  currentPeriodEnd?: string | null
  promoCodeId?: string
  raw: unknown
}

export interface PaymentProvider {
  readonly id: PaymentProviderId
  readonly capabilities: PaymentProviderCapabilities
  isConfigured(): boolean

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>
  createSubscription(input: CreateSubscriptionInput): Promise<Subscription>
  cancelSubscription(subscriptionId: string): Promise<void>
  getCustomer(customerId: string): Promise<PaymentCustomer | null>
  refund(paymentId: string, opts?: RefundOptions): Promise<void>

  verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string): boolean | Promise<boolean>
  handleWebhook(rawBody: Buffer | string): Promise<NormalizedPaymentEvent>
}

export interface StripePaymentsConfig {
  secretKey?: string
  publishableKey?: string
  webhookSecret?: string
  frontendUrl?: string
  priceIdForPlan: (planType: PlanType) => Promise<string | null>
}

export interface QerkoPaymentsConfig {
  isConfigured: () => boolean
  createCheckout: (input: CreateCheckoutSessionInput) => Promise<CheckoutSession>
  verifyWebhook: (rawBody: string, signatureHeader: string | null) => Promise<boolean>
  parseWebhook: (rawBody: string) => Promise<NormalizedPaymentEvent>
  cancelSubscription: (subscriptionId: string) => Promise<void>
  getCustomer: (customerId: string) => Promise<PaymentCustomer | null>
  refund: (paymentId: string, opts?: RefundOptions) => Promise<void>
  createSubscription: (input: CreateSubscriptionInput) => Promise<Subscription>
}

export interface PaymentsConfig {
  stripe?: StripePaymentsConfig
  qerko?: QerkoPaymentsConfig
}
