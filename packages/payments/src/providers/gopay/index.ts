/**
 * GoPay payment provider (draft).
 *
 * Checkout is redirect-only via `gw_url`. Recurring billing uses GoPay automatic
 * recurrence (MONTH cycle). Notifications are unsigned GET callbacks; authenticity
 * is established by fetching payment status with merchant credentials.
 *
 * One-click / wallet limitations (see packages/payments/README.md):
 * - Apple Pay / Google Pay only inside the GoPay web gateway
 * - No native in-app Apple/Google Pay dialogs
 * - Do not embed the gateway in a WebView
 */

import { NotImplementedError } from '../../errors.js';
import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  CreateSubscriptionInput,
  GoPayPaymentsConfig,
  NormalizedPaymentEvent,
  PaymentCustomer,
  PaymentProvider,
  PlanType,
  RefundOptions,
  Subscription,
} from '../../types.js';

const DEFAULT_API_BASE = 'https://gw.sandbox.gopay.com/api';
const TOKEN_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

type TokenCache = { accessToken: string; expiresAtMs: number };

export type GoPayPaymentState =
  | 'CREATED'
  | 'PAYMENT_METHOD_CHOSEN'
  | 'PAID'
  | 'AUTHORIZED'
  | 'CANCELED'
  | 'TIMEOUTED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | string;

export interface GoPayPaymentStatus {
  id?: number | string;
  parent_id?: number | string;
  order_number?: string;
  state?: GoPayPaymentState;
  amount?: number;
  currency?: string;
  gw_url?: string;
  recurrence?: {
    recurrence_cycle?: string;
    recurrence_period?: number;
    recurrence_date_to?: string;
    recurrence_state?: string;
  };
  additional_params?: Array<{ name?: string; value?: string }>;
  payer?: { contact?: { email?: string } };
  errors?: unknown;
}

function encodeBasicAuth(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`);
}

function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/** GoPay rejects recurrence_date_to of 2099-12-31; must be strictly earlier. */
const GOPAY_RECURRENCE_DATE_TO = '2099-12-30';

function recurrenceForPlan(planType: PlanType): {
  recurrence_cycle: 'MONTH';
  recurrence_period: number;
  recurrence_date_to: string;
} {
  // Club bills yearly on GoPay (12-month recurrence) but keeps planType=club for VMP entitlements.
  const period = planType === 'monthly' ? 1 : 12;
  return {
    recurrence_cycle: 'MONTH',
    recurrence_period: period,
    recurrence_date_to: GOPAY_RECURRENCE_DATE_TO,
  };
}

function paramsToRecord(
  params: Array<{ name?: string; value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of params ?? []) {
    const name = String(row?.name ?? '').trim();
    if (!name) continue;
    out[name] = String(row?.value ?? '');
  }
  return out;
}

function mapGoPayStateToEvent(state: string, hasParent: boolean): NormalizedPaymentEvent['type'] {
  const s = state.toUpperCase();
  if (s === 'PAID' || s === 'AUTHORIZED') {
    return hasParent ? 'invoice.paid' : 'checkout.completed';
  }
  if (s === 'CANCELED' || s === 'TIMEOUTED') {
    return hasParent ? 'payment.failed' : 'payment.failed';
  }
  if (s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED') {
    return 'subscription.updated';
  }
  return 'unknown';
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const err = new Error('GoPay request timed out');
      Object.assign(err, { status: 504, code: 'gopay_timeout' });
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createGoPayProvider(config: GoPayPaymentsConfig): PaymentProvider {
  const apiBase = String(config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  let tokenCache: TokenCache | null = null;

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAtMs > now + TOKEN_SKEW_MS) {
      return tokenCache.accessToken;
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error('GoPay client credentials are not configured');
    }
    const res = await fetchWithTimeout(`${apiBase}/oauth2/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${encodeBasicAuth(config.clientId, config.clientSecret)}`,
      },
      body: 'grant_type=client_credentials&scope=payment-all',
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      errors?: unknown;
    };
    if (!res.ok || !data.access_token) {
      const err = new Error('Failed to obtain GoPay access token');
      Object.assign(err, { code: 'gopay_auth_failed', status: res.status, details: data });
      throw err;
    }
    const expiresInSec = Number(data.expires_in ?? 1800);
    tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + Math.max(60, expiresInSec) * 1000,
    };
    return data.access_token;
  }

  async function gopayJson(
    method: string,
    path: string,
    body?: Record<string, unknown> | string,
  ): Promise<Record<string, unknown>> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      if (typeof body === 'string') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetchWithTimeout(`${apiBase}${path}`, {
      method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = new Error(`GoPay API ${method} ${path} failed`);
      Object.assign(err, { code: 'gopay_api_failed', status: res.status, details: data });
      throw err;
    }
    return data;
  }

  async function getPaymentStatus(paymentId: string): Promise<GoPayPaymentStatus> {
    return (await gopayJson(
      'GET',
      `/payments/payment/${encodeURIComponent(paymentId)}`,
    )) as GoPayPaymentStatus;
  }

  return {
    id: 'gopay',
    capabilities: {
      newSubscriptions: true,
      migrationOnly: false,
      recurringPayments: true,
      refunds: true,
      webhooks: true,
    },
    isConfigured: () =>
      Boolean(
        config.clientId &&
          config.clientSecret &&
          config.goId &&
          config.frontendUrl &&
          config.notificationUrl,
      ),

    async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
      const amountMajor = await config.amountMajorForPlan(input.planType);
      if (amountMajor == null || !(amountMajor > 0)) {
        throw new Error('GoPay price not configured for plan');
      }
      const currency = String((await config.currency()) || 'CZK')
        .trim()
        .toUpperCase();
      const amount = toMinorUnits(amountMajor);
      const frontendUrl = String(config.frontendUrl ?? '').replace(/\/$/, '');
      const returnUrl = `${frontendUrl}${input.returnPath}${
        input.returnPath.includes('?') ? '&' : '?'
      }gopay=return`;
      const orderNumber = (input.purchaseId || `vmp-${input.userId.slice(0, 8)}-${Date.now()}`)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 50);

      const created = (await gopayJson('POST', '/payments/payment', {
        amount,
        currency,
        order_number: orderNumber,
        order_description: `VMP ${input.planType}`,
        payer: {
          contact: { email: input.email },
          // Wallet methods appear only on the hosted gateway — not as native one-click.
          allowed_payment_instruments: [
            'PAYMENT_CARD',
            'BANK_ACCOUNT',
            'APPLE_PAY',
            'GPAY',
            'CLICK_TO_PAY',
          ],
        },
        target: { type: 'ACCOUNT', goid: Number(config.goId) },
        callback: {
          return_url: returnUrl,
          notification_url: config.notificationUrl,
        },
        recurrence: recurrenceForPlan(input.planType),
        additional_params: [
          { name: 'userId', value: input.userId },
          { name: 'planType', value: input.planType },
          { name: 'provider', value: 'gopay' },
        ],
        lang: 'CS',
      })) as GoPayPaymentStatus;

      if (!created.gw_url || created.id == null) {
        const err = new Error('GoPay did not return a gateway URL');
        Object.assign(err, { code: 'gopay_checkout_failed', details: created });
        throw err;
      }

      return {
        provider: 'gopay',
        checkoutUrl: String(created.gw_url),
        orderId: String(created.id),
        metadata: {
          userId: input.userId,
          planType: input.planType,
          orderNumber,
        },
      };
    },

    async createSubscription(_input: CreateSubscriptionInput): Promise<Subscription> {
      throw new NotImplementedError(
        'GoPay subscriptions must be started via createCheckoutSession (hosted gateway)',
      );
    },

    async cancelSubscription(subscriptionId: string): Promise<void> {
      await gopayJson(
        'POST',
        `/payments/payment/${encodeURIComponent(subscriptionId)}/void-recurrence`,
      );
    },

    async getCustomer(customerId: string): Promise<PaymentCustomer | null> {
      // GoPay has no first-class customer object; payer email lives on payments.
      return { id: customerId };
    },

    async refund(paymentId: string, opts?: RefundOptions): Promise<void> {
      if (opts?.amountMinor == null) {
        throw new Error('GoPay refunds require amountMinor (haléře / minor units)');
      }
      await gopayJson(
        'POST',
        `/payments/payment/${encodeURIComponent(paymentId)}/refund`,
        `amount=${encodeURIComponent(String(opts.amountMinor))}`,
      );
    },

    /**
     * GoPay notifications are unsigned GET callbacks. Verification is done by
     * re-fetching the payment with merchant credentials inside handleWebhook.
     * Signature header is ignored; return true when credentials are present.
     */
    async verifyWebhookSignature(
      _rawBody: Buffer | string,
      _signatureHeader: string,
    ): Promise<boolean> {
      return Boolean(config.clientId && config.clientSecret && config.goId);
    },

    async handleWebhook(rawBody: Buffer | string): Promise<NormalizedPaymentEvent> {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
      let payload: { id?: string; parent_id?: string } = {};
      try {
        payload = body ? (JSON.parse(body) as { id?: string; parent_id?: string }) : {};
      } catch {
        payload = {};
      }
      const paymentId = String(payload.id ?? '').trim();
      if (!paymentId) {
        return { type: 'unknown', providerId: 'gopay', raw: payload };
      }

      const status = await getPaymentStatus(paymentId);
      const meta = paramsToRecord(status.additional_params);
      const parentId =
        status.parent_id != null && String(status.parent_id).trim()
          ? String(status.parent_id)
          : String(payload.parent_id ?? '').trim() || undefined;
      const subscriptionId = parentId || String(status.id ?? paymentId);
      const planType = (meta.planType as PlanType | undefined) ?? undefined;
      const userId = meta.userId || undefined;
      const eventType = mapGoPayStateToEvent(String(status.state ?? ''), Boolean(parentId));

      return {
        type: eventType,
        providerId: 'gopay',
        ...(userId ? { userId } : {}),
        ...(planType ? { planType } : {}),
        subscriptionId,
        providerOrderId: String(status.id ?? paymentId),
        ...(parentId ? { purchaseId: parentId } : {}),
        status: String(status.state ?? ''),
        raw: status,
      };
    },
  };
}

export { DEFAULT_API_BASE as GOPAY_DEFAULT_API_BASE, recurrenceForPlan, toMinorUnits };
