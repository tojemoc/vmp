import type {
  NormalizedInvoiceBuyer,
  NormalizedInvoiceData,
  NormalizedInvoiceLineItem,
} from '../../types.js';

function normalizeCountryCode(value: unknown): string | null {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

function hasBusinessVatId(vatId: string | null): boolean {
  if (!vatId) return false;
  return /^(SK|CZ|AT|DE|PL|HU)\d/i.test(vatId.trim());
}

function centsFromStripeAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function isoDateFromUnixSeconds(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString().slice(0, 10);
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function deriveVatRatePercent(netCents: number, taxCents: number): number | null {
  if (netCents <= 0 || taxCents <= 0) return taxCents > 0 ? null : 0;
  const rate = (taxCents / netCents) * 100;
  return Math.round(rate * 100) / 100;
}

export function extractBuyerFromStripeInvoice(
  stripeInvoice: Record<string, unknown>,
  fallbackEmail?: string | null,
): NormalizedInvoiceBuyer {
  const customerAddress =
    stripeInvoice.customer_address && typeof stripeInvoice.customer_address === 'object'
      ? (stripeInvoice.customer_address as Record<string, unknown>)
      : null;
  const taxIds = Array.isArray(stripeInvoice.customer_tax_ids)
    ? stripeInvoice.customer_tax_ids
    : [];
  const primaryTax = taxIds.find(
    (entry: unknown) =>
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { value?: unknown }).value === 'string',
  ) as { value?: string } | undefined;
  const vatId =
    typeof primaryTax?.value === 'string'
      ? primaryTax.value
      : typeof stripeInvoice.customer_tax_id === 'string'
        ? stripeInvoice.customer_tax_id
        : null;
  const shipping =
    stripeInvoice.customer_shipping && typeof stripeInvoice.customer_shipping === 'object'
      ? (stripeInvoice.customer_shipping as { address?: { country?: unknown }; name?: unknown })
      : null;
  const country = normalizeCountryCode(customerAddress?.country ?? shipping?.address?.country);
  const name =
    String(stripeInvoice.customer_name || shipping?.name || '').trim() || null;
  const email = String(stripeInvoice.customer_email || fallbackEmail || '').trim() || null;
  const isBusiness = hasBusinessVatId(vatId) || Boolean(name && name !== email);

  return {
    country,
    vatId,
    name,
    email,
    address: customerAddress
      ? {
          line1: (customerAddress.line1 as string | null | undefined) ?? null,
          city: (customerAddress.city as string | null | undefined) ?? null,
          postalCode: (customerAddress.postal_code as string | null | undefined) ?? null,
          country: normalizeCountryCode(customerAddress.country),
        }
      : null,
    peppolEndpointId: vatId,
    peppolSchemeId: country === 'SK' || country === 'CZ' ? '9935' : null,
    isBusiness,
  };
}

export function buildLineItemsFromStripeInvoice(
  stripeInvoice: Record<string, unknown>,
  planType: string | null,
): NormalizedInvoiceLineItem[] {
  const linesContainer = stripeInvoice.lines;
  const lines =
    linesContainer &&
    typeof linesContainer === 'object' &&
    Array.isArray((linesContainer as { data?: unknown[] }).data)
      ? ((linesContainer as { data: unknown[] }).data as Record<string, unknown>[])
      : [];
  if (lines.length === 0) {
    const net = centsFromStripeAmount(
      stripeInvoice.subtotal ?? stripeInvoice.total_excluding_tax,
    );
    const tax = centsFromStripeAmount(stripeInvoice.tax ?? 0);
    return [
      {
        description: planType ? `VMP subscription (${planType})` : 'VMP subscription',
        quantity: 1,
        netAmountCents: net,
        vatRatePercent: deriveVatRatePercent(net, tax),
      },
    ];
  }

  return lines.map((line) => {
    const net = centsFromStripeAmount(line.amount_excluding_tax ?? line.amount);
    const taxAmounts = Array.isArray(line.tax_amounts) ? line.tax_amounts : [];
    const tax = taxAmounts.reduce(
      (sum: number, entry: unknown) =>
        sum +
        centsFromStripeAmount(
          entry && typeof entry === 'object'
            ? (entry as { amount?: unknown }).amount
            : undefined,
        ),
      0,
    );
    const price =
      line.price && typeof line.price === 'object'
        ? (line.price as { nickname?: unknown })
        : null;
    const description = String(line.description || price?.nickname || 'VMP subscription').trim();
    return {
      description,
      quantity: Number(line.quantity ?? 1) || 1,
      netAmountCents: net,
      vatRatePercent: deriveVatRatePercent(net, tax),
    };
  });
}

export function normalizeStripeInvoice(
  stripeInvoice: Record<string, unknown>,
  options?: { planType?: string | null; fallbackEmail?: string | null },
): NormalizedInvoiceData | null {
  const providerInvoiceId = String(stripeInvoice.id ?? '').trim();
  if (!providerInvoiceId) return null;

  const statusTransitions =
    stripeInvoice.status_transitions && typeof stripeInvoice.status_transitions === 'object'
      ? (stripeInvoice.status_transitions as { paid_at?: unknown })
      : null;
  const netAmountCents = centsFromStripeAmount(
    stripeInvoice.subtotal ?? stripeInvoice.total_excluding_tax,
  );
  const taxAmountCents = centsFromStripeAmount(stripeInvoice.tax ?? 0);
  const grossAmountCents = centsFromStripeAmount(
    stripeInvoice.total ?? netAmountCents + taxAmountCents,
  );

  return {
    providerInvoiceId,
    providerPaymentId:
      typeof stripeInvoice.payment_intent === 'string'
        ? stripeInvoice.payment_intent
        : stripeInvoice.payment_intent &&
            typeof stripeInvoice.payment_intent === 'object' &&
            typeof (stripeInvoice.payment_intent as { id?: unknown }).id === 'string'
          ? String((stripeInvoice.payment_intent as { id: string }).id)
          : null,
    providerSubscriptionId:
      typeof stripeInvoice.subscription === 'string'
        ? stripeInvoice.subscription
        : stripeInvoice.subscription &&
            typeof stripeInvoice.subscription === 'object' &&
            typeof (stripeInvoice.subscription as { id?: unknown }).id === 'string'
          ? String((stripeInvoice.subscription as { id: string }).id)
          : null,
    issueDate: isoDateFromUnixSeconds(statusTransitions?.paid_at ?? stripeInvoice.created),
    currency: String(stripeInvoice.currency || 'eur').toUpperCase(),
    netAmountCents,
    taxAmountCents,
    grossAmountCents,
    buyer: extractBuyerFromStripeInvoice(stripeInvoice, options?.fallbackEmail),
    lineItems: buildLineItemsFromStripeInvoice(stripeInvoice, options?.planType ?? null),
  };
}
