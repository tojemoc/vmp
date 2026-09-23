import type { NormalizedInvoiceBuyer, NormalizedInvoiceData, PlanType } from '../types.js';

/**
 * Build a minimal NormalizedInvoiceData from a redirect-gateway payment
 * confirmation (GoPay / Comgate). These gateways do not return a Stripe-style
 * tax breakdown; amounts are treated as gross with tax 0 so e-invoicing can
 * still archive / route when enabled.
 */
export function normalizeRedirectGatewayInvoice(params: {
  providerInvoiceId: string;
  providerPaymentId?: string | null;
  providerSubscriptionId?: string | null;
  amountMinor: number;
  currency: string;
  email?: string | null;
  planType?: PlanType | null;
  issueDate?: string | null;
}): NormalizedInvoiceData | null {
  const providerInvoiceId = String(params.providerInvoiceId ?? '').trim();
  if (!providerInvoiceId) return null;
  const amountMinor = Math.round(Number(params.amountMinor));
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;

  const currency = String(params.currency || 'CZK')
    .trim()
    .toUpperCase();
  const email = String(params.email ?? '')
    .trim()
    .toLowerCase();
  const planType = params.planType ? String(params.planType) : null;
  const description = planType ? `VMP ${planType}` : 'VMP subscription';
  const issueDate =
    String(params.issueDate ?? '')
      .trim()
      .slice(0, 10) || new Date().toISOString().slice(0, 10);

  const buyer: NormalizedInvoiceBuyer = {
    country: null,
    vatId: null,
    name: null,
    email: email || null,
    address: null,
    isBusiness: false,
  };

  return {
    providerInvoiceId,
    providerPaymentId: params.providerPaymentId ?? providerInvoiceId,
    providerSubscriptionId: params.providerSubscriptionId ?? null,
    issueDate,
    currency: currency || 'CZK',
    netAmountCents: amountMinor,
    taxAmountCents: 0,
    grossAmountCents: amountMinor,
    buyer,
    lineItems: [
      {
        description,
        quantity: 1,
        netAmountCents: amountMinor,
        vatRatePercent: null,
      },
    ],
  };
}
