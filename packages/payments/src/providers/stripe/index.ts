import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  CreateSubscriptionInput,
  NormalizedPaymentEvent,
  PaymentCustomer,
  PaymentProvider,
  RefundOptions,
  StripePaymentsConfig,
  Subscription,
} from '../../types.js'

const STRIPE_API_VERSION = '2026-03-25.dahlia'

function encodeStripeBody(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    const fullKey = prefix ? `${prefix}[${key}]` : key
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeStripeBody(value as Record<string, unknown>, fullKey))
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeStripeBody(item as Record<string, unknown>, `${fullKey}[${i}]`))
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`)
        }
      })
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.join('&')
}

async function stripePost(config: StripePaymentsConfig, path: string, body: Record<string, unknown>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Stripe-Version': STRIPE_API_VERSION,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: encodeStripeBody(body),
      signal: controller.signal,
    })
    return await res.json() as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const err = new Error('Stripe request timed out')
      Object.assign(err, { status: 504, code: 'stripe_timeout' })
      throw err
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function stripeGet(config: StripePaymentsConfig, path: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Stripe-Version': STRIPE_API_VERSION,
      },
      signal: controller.signal,
    })
    return await res.json() as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const err = new Error('Stripe request timed out')
      Object.assign(err, { status: 504, code: 'stripe_timeout' })
      throw err
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function verifyStripeWebhook(rawBody: string, sigHeader: string, secret: string): Promise<boolean> {
  if (!sigHeader || !secret) return false
  let ts: number | null = null
  const v1s: string[] = []
  for (const segment of sigHeader.split(',')) {
    const eq = segment.indexOf('=')
    if (eq === -1) continue
    const k = segment.slice(0, eq)
    const v = segment.slice(eq + 1)
    if (k === 't') ts = Number(v)
    else if (k === 'v1') v1s.push(v)
  }
  if (!ts || v1s.length === 0) return false
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false
  const signedPayload = `${ts}.${rawBody}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const expected = [...new Uint8Array(sigBytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
  for (const candidate of v1s) {
    if (expected.length !== candidate.length) continue
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i)
    if (diff === 0) return true
  }
  return false
}

export function createStripeProvider(config: StripePaymentsConfig): PaymentProvider {
  return {
    id: 'stripe',
    capabilities: {
      newSubscriptions: true,
      migrationOnly: false,
      recurringPayments: true,
      refunds: true,
      webhooks: true,
    },
    isConfigured: () => Boolean(config.secretKey),

    async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
      const priceId = await config.priceIdForPlan(input.planType)
      if (!priceId) throw new Error('Stripe price not configured for plan')
      const frontendUrl = String(config.frontendUrl ?? 'http://localhost:3000').replace(/\/$/, '')
      const sessionPayload: Record<string, unknown> = {
        mode: 'subscription',
        ui_mode: 'elements',
        payment_method_types: ['card', 'paypal', 'sepa_debit'],
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: input.email,
        metadata: {
          userId: input.userId,
          provider: 'stripe',
          planType: input.planType,
          ...(input.promo?.metadata ?? {}),
        },
        return_url: `${frontendUrl}${input.returnPath}?session_id={CHECKOUT_SESSION_ID}`,
      }
      if (input.promo?.stripeCouponId) {
        sessionPayload.discounts = [{ coupon: input.promo.stripeCouponId }]
      }
      const session = await stripePost(config, '/checkout/sessions', sessionPayload)
      if (session.error || !session.client_secret) {
        const err = new Error(
          typeof (session.error as { message?: string } | undefined)?.message === 'string'
            ? (session.error as { message: string }).message
            : 'Failed to create checkout session',
        )
        Object.assign(err, { code: 'stripe_checkout_failed', stripeError: session.error })
        throw err
      }
      return {
        provider: 'stripe',
        clientSecret: String(session.client_secret),
        ...(session.metadata ? { metadata: session.metadata as Record<string, string> } : {}),
      }
    },

    async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
      const priceId = await config.priceIdForPlan(input.planType)
      if (!priceId) throw new Error('Stripe price not configured for plan')
      const sub = await stripePost(config, '/subscriptions', {
        customer: input.customerId,
        items: [{ price: priceId }],
        metadata: { userId: input.userId, planType: input.planType },
      })
      return {
        id: String(sub.id ?? ''),
        customerId: typeof sub.customer === 'string' ? sub.customer : null,
        status: String(sub.status ?? ''),
        planType: input.planType,
      }
    },

    async cancelSubscription(subscriptionId: string): Promise<void> {
      await stripePost(config, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: true })
    },

    async getCustomer(customerId: string): Promise<PaymentCustomer | null> {
      const customer = await stripeGet(config, `/customers/${encodeURIComponent(customerId)}`)
      if (customer.error) return null
      return { id: String(customer.id ?? customerId), email: typeof customer.email === 'string' ? customer.email : null }
    },

    async refund(paymentId: string, opts?: RefundOptions): Promise<void> {
      await stripePost(config, '/refunds', {
        payment_intent: paymentId,
        ...(opts?.amountMinor != null ? { amount: opts.amountMinor } : {}),
        ...(opts?.reason ? { reason: opts.reason } : {}),
      })
    },

    async verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string): Promise<boolean> {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody)
      if (!config.webhookSecret) return false
      return verifyStripeWebhook(body, signatureHeader, config.webhookSecret)
    },

    async handleWebhook(rawBody: Buffer | string): Promise<NormalizedPaymentEvent> {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody)
      const event = JSON.parse(body) as { type?: string; data?: { object?: Record<string, unknown> } }
      const object = event.data?.object ?? {}
      const metadata = (object.metadata ?? {}) as Record<string, string>
      const base = {
        providerId: 'stripe' as const,
        raw: event,
        ...(metadata.userId ? { userId: metadata.userId } : {}),
        ...(metadata.planType ? { planType: metadata.planType as CreateCheckoutSessionInput['planType'] } : {}),
        ...(metadata.promoCodeId ? { promoCodeId: metadata.promoCodeId } : {}),
      }
      switch (event.type) {
        case 'checkout.session.completed':
          return {
            ...base,
            type: 'checkout.completed' as const,
            ...(typeof object.subscription === 'string' ? { subscriptionId: object.subscription } : {}),
            ...(typeof object.customer === 'string' ? { customerId: object.customer } : {}),
          }
        case 'customer.subscription.updated':
          return {
            ...base,
            type: 'subscription.updated' as const,
            subscriptionId: String(object.id ?? ''),
            ...(typeof object.customer === 'string' ? { customerId: object.customer } : {}),
            status: String(object.status ?? ''),
          }
        case 'customer.subscription.deleted':
          return {
            ...base,
            type: 'subscription.deleted' as const,
            subscriptionId: String(object.id ?? ''),
            status: 'cancelled',
          }
        case 'invoice.paid':
          return {
            ...base,
            type: 'invoice.paid' as const,
            ...(typeof object.subscription === 'string' ? { subscriptionId: object.subscription } : {}),
            ...(typeof object.customer === 'string' ? { customerId: object.customer } : {}),
          }
        case 'invoice.payment_failed':
          return {
            ...base,
            type: 'payment.failed' as const,
            ...(typeof object.subscription === 'string' ? { subscriptionId: object.subscription } : {}),
            status: 'past_due',
          }
        default:
          return { ...base, type: 'unknown' as const }
      }
    },
  }
}

// Re-export for api compatibility
export { STRIPE_API_VERSION }
