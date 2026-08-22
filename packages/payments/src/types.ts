import type { PaymentProviderId } from './ids.js';

export interface PaymentProviderCapabilities {
  newSubscriptions: boolean;
  migrationOnly: boolean;
  recurringPayments: boolean;
  refunds: boolean;
  webhooks: boolean;
}

export type PlanType = 'monthly' | 'yearly' | 'club';

export interface PaymentCustomer {
  id: string;
  email?: string | null;
}

export interface CheckoutSession {
  provider: PaymentProviderId;
  clientSecret?: string;
  checkoutUrl?: string;
  orderId?: string;
  metadata?: Record<string, string>;
}

export interface Subscription {
  id: string;
  customerId?: string | null;
  status: string;
  planType?: PlanType;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

export interface CreateCheckoutSessionInput {
  userId: string;
  email: string;
  planType: PlanType;
  returnPath: string;
  purchaseId?: string;
  promo?: {
    stripeCouponId?: string;
    metadata?: Record<string, string>;
  };
}

export interface CreateSubscriptionInput {
  userId: string;
  planType: PlanType;
  customerId?: string;
}

export interface RefundOptions {
  amountMinor?: number;
  reason?: string;
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
  | 'unknown';

/** Buyer details extracted from a provider invoice/payment confirmation. */
export interface NormalizedInvoiceBuyerAddress {
  line1?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface NormalizedInvoiceBuyer {
  country: string | null;
  vatId: string | null;
  name: string | null;
  email: string | null;
  address: NormalizedInvoiceBuyerAddress | null;
  peppolEndpointId?: string | null;
  peppolSchemeId?: string | null;
  isBusiness: boolean;
}

export interface NormalizedInvoiceLineItem {
  description: string;
  quantity: number;
  netAmountCents: number;
  vatRatePercent: number | null;
}

/** Provider-agnostic invoice payload for e-invoicing and ledger writes. */
export interface NormalizedInvoiceData {
  providerInvoiceId: string;
  providerPaymentId?: string | null;
  providerSubscriptionId?: string | null;
  issueDate: string;
  currency: string;
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  buyer: NormalizedInvoiceBuyer;
  lineItems: NormalizedInvoiceLineItem[];
}

export interface NormalizedPaymentEvent {
  type: NormalizedPaymentEventType;
  providerId: PaymentProviderId;
  userId?: string;
  planType?: PlanType;
  subscriptionId?: string;
  customerId?: string;
  purchaseId?: string;
  providerOrderId?: string;
  status?: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  promoCodeId?: string;
  /** Populated on `invoice.paid` when the provider can supply invoice details. */
  invoice?: NormalizedInvoiceData;
  raw: unknown;
}

export interface ManageSubscriptionInput {
  customerId?: string | null;
  subscriptionId?: string | null;
  returnUrl?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly capabilities: PaymentProviderCapabilities;
  isConfigured(): boolean;

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
  createSubscription(input: CreateSubscriptionInput): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getCustomer(customerId: string): Promise<PaymentCustomer | null>;
  refund(paymentId: string, opts?: RefundOptions): Promise<void>;

  verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader: string,
  ): boolean | Promise<boolean>;
  handleWebhook(rawBody: Buffer | string): Promise<NormalizedPaymentEvent>;

  /** Customer self-service URL (billing portal, bank app, etc.), or null if unsupported. */
  getManageUrl?(input: ManageSubscriptionInput): Promise<string | null>;
}

export interface StripePaymentsConfig {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
  frontendUrl?: string;
  priceIdForPlan: (planType: PlanType) => Promise<string | null>;
}

export interface QerkoPaymentsConfig {
  isConfigured: () => boolean;
  createCheckout: (input: CreateCheckoutSessionInput) => Promise<CheckoutSession>;
  verifyWebhook: (rawBody: string, signatureHeader: string | null) => Promise<boolean>;
  parseWebhook: (rawBody: string) => Promise<NormalizedPaymentEvent>;
  cancelSubscription: (subscriptionId: string) => Promise<void>;
  getCustomer: (customerId: string) => Promise<PaymentCustomer | null>;
  refund: (paymentId: string, opts?: RefundOptions) => Promise<void>;
  createSubscription: (input: CreateSubscriptionInput) => Promise<Subscription>;
  getManageUrl?: (input: ManageSubscriptionInput) => Promise<string | null>;
}

export interface PaymentsConfig {
  stripe?: StripePaymentsConfig;
  qerko?: QerkoPaymentsConfig;
}
