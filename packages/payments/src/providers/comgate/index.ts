/**
 * Comgate payment provider (draft).
 *
 * Checkout is redirect-only via `redirect` URL from /v1.0/create.
 * Recurring billing uses initRecurring=true on the initial payment, then
 * background /v1.0/recurring calls for renewals (merchant-driven scheduling).
 * Notifications are POST callbacks with `secret` verification; status should
 * still be re-verified via /v1.0/status.
 *
 * Comgate recurring payments require activation by Comgate support for the
 * merchant's account. Card payments only via ČSOB or Česká spořitelna.
 */

import type {
  CheckoutSession,
  ComgatePaymentsConfig,
  CreateCheckoutSessionInput,
  CreateSubscriptionInput,
  NormalizedPaymentEvent,
  PaymentCustomer,
  PaymentProvider,
  PlanType,
  RefundOptions,
  Subscription,
} from '../../types.js';

const DEFAULT_API_BASE = 'https://payments.comgate.cz';
const REQUEST_TIMEOUT_MS = 10_000;

export type ComgatePaymentStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'AUTHORIZED' | string;

function encodeFormBody(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

function parseFormResponse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
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
      const err = new Error('Comgate request timed out');
      Object.assign(err, { status: 504, code: 'comgate_timeout' });
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapComgateStatusToEvent(
  status: string,
  isRecurring: boolean,
): NormalizedPaymentEvent['type'] {
  const s = status.toUpperCase();
  if (s === 'PAID') return isRecurring ? 'invoice.paid' : 'checkout.completed';
  if (s === 'CANCELLED') return 'payment.failed';
  if (s === 'AUTHORIZED') return isRecurring ? 'invoice.paid' : 'checkout.completed';
  return 'unknown';
}

export function createComgateProvider(config: ComgatePaymentsConfig): PaymentProvider {
  const apiBase = String(config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');

  async function comgatePost(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<Record<string, string>> {
    const body = encodeFormBody({
      merchant: config.merchant,
      secret: config.secret,
      ...params,
    });
    const res = await fetchWithTimeout(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/x-www-form-urlencoded',
      },
      body,
    });
    const text = await res.text();
    const parsed = parseFormResponse(text);
    if (parsed.code && parsed.code !== '0') {
      const err = new Error(`Comgate ${path}: ${parsed.message ?? 'error'} (code=${parsed.code})`);
      Object.assign(err, { code: 'comgate_api_error', status: res.status, details: parsed });
      throw err;
    }
    return parsed;
  }

  async function getPaymentStatus(transId: string): Promise<Record<string, string>> {
    return comgatePost('/v1.0/status', { transId });
  }

  return {
    id: 'comgate',
    capabilities: {
      newSubscriptions: true,
      migrationOnly: false,
      recurringPayments: true,
      refunds: true,
      webhooks: true,
    },
    isConfigured: () => Boolean(config.merchant && config.secret && config.frontendUrl),

    /** Used by Worker renewal reconciliation (not part of the public PaymentProvider surface). */
    getPaymentStatus,

    async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
      const amountMajor = await config.amountMajorForPlan(input.planType);
      if (amountMajor == null || !(amountMajor > 0)) {
        throw new Error('Comgate price not configured for plan');
      }
      const currency = String((await config.currency()) || 'CZK')
        .trim()
        .toUpperCase();
      const priceMinor = Math.round(amountMajor * 100);
      const frontendUrl = String(config.frontendUrl ?? '').replace(/\/$/, '');
      const refId = (input.purchaseId || `vmp-${input.userId.slice(0, 8)}-${Date.now()}`)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 50);
      const label = `VMP ${input.planType}`.slice(0, 16);
      const returnUrl = `${frontendUrl}${input.returnPath}${
        input.returnPath.includes('?') ? '&' : '?'
      }comgate=return&refId=\${refId}&transId=\${id}`;

      const result = await comgatePost('/v1.0/create', {
        price: priceMinor,
        curr: currency,
        label,
        refId,
        method: 'ALL',
        email: input.email,
        prepareOnly: true,
        initRecurring: true,
        country: config.country ?? 'CZ',
        lang: config.lang ?? 'cs',
        // Comgate substitutes ${refId} / ${id} in the merchant return URL.
        url: returnUrl,
      });

      if (!result.redirect || !result.transId) {
        const err = new Error('Comgate did not return a redirect URL');
        Object.assign(err, { code: 'comgate_checkout_failed', details: result });
        throw err;
      }

      return {
        provider: 'comgate',
        checkoutUrl: result.redirect,
        orderId: result.transId,
        metadata: {
          userId: input.userId,
          planType: input.planType,
          refId,
        },
      };
    },

    async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
      const initRecurringId = String(input.initRecurringId ?? '').trim();
      if (!initRecurringId) {
        const err = new Error(
          'Comgate renewals require initRecurringId (original checkout transId)',
        );
        Object.assign(err, { status: 400, code: 'comgate_init_recurring_id_required' });
        throw err;
      }
      const amountMajor = await config.amountMajorForPlan(input.planType);
      if (amountMajor == null || !(amountMajor > 0)) {
        throw new Error('Comgate price not configured for plan');
      }
      const currency = String((await config.currency()) || 'CZK')
        .trim()
        .toUpperCase();
      const priceMinor = Math.round(amountMajor * 100);
      const label = `VMP ${input.planType}`.slice(0, 16);
      const refId = `vmp-r-${input.userId.slice(0, 8)}-${Date.now()}`
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 50);

      const result = await comgatePost('/v1.0/recurring', {
        initRecurringId,
        price: priceMinor,
        curr: currency,
        label,
        refId,
        ...(input.email ? { email: input.email } : {}),
      });

      const renewalTransId = String(result.transId ?? '').trim();
      if (!renewalTransId) {
        const err = new Error('Comgate recurring payment did not return transId');
        Object.assign(err, { code: 'comgate_renewal_failed', details: result });
        throw err;
      }

      return {
        id: initRecurringId,
        customerId: input.userId,
        status: 'active',
        planType: input.planType,
        lastPaymentId: renewalTransId,
      };
    },

    async cancelSubscription(subscriptionId: string): Promise<void> {
      await comgatePost('/v1.0/cancel', { transId: subscriptionId });
    },

    async getCustomer(customerId: string): Promise<PaymentCustomer | null> {
      return { id: customerId };
    },

    async refund(paymentId: string, opts?: RefundOptions): Promise<void> {
      if (opts?.amountMinor == null) {
        throw new Error('Comgate refunds require amountMinor (haléře / minor units)');
      }
      await comgatePost('/v1.0/refund', {
        transId: paymentId,
        amount: opts.amountMinor,
      });
    },

    /**
     * Comgate webhooks include the `secret` field. Verify it matches.
     */
    async verifyWebhookSignature(
      rawBody: Buffer | string,
      _signatureHeader: string,
    ): Promise<boolean> {
      if (!config.secret) return false;
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
      const parsed = parseFormResponse(body);
      return parsed.secret === config.secret;
    },

    async handleWebhook(rawBody: Buffer | string): Promise<NormalizedPaymentEvent> {
      const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
      const notification = parseFormResponse(body);
      const transId = String(notification.transId ?? '').trim();
      if (!transId) {
        return { type: 'unknown', providerId: 'comgate', raw: notification };
      }

      const status = await getPaymentStatus(transId);
      const refId = String(status.refId ?? notification.refId ?? '').trim();
      const initRecurringId = String(
        notification.initRecurringId || status.initRecurringId || '',
      ).trim();
      const isRecurring = Boolean(initRecurringId);
      const eventType = mapComgateStatusToEvent(
        String(status.status ?? notification.status ?? ''),
        isRecurring,
      );

      return {
        type: eventType,
        providerId: 'comgate',
        // Keep the original checkout transId as the subscription id; the current
        // payment's transId is stored separately as providerOrderId.
        subscriptionId: initRecurringId || transId,
        providerOrderId: transId,
        ...(refId ? { purchaseId: refId } : {}),
        status: String(status.status ?? ''),
        raw: status,
      };
    },
  };
}

export { DEFAULT_API_BASE as COMGATE_DEFAULT_API_BASE };
