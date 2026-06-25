/**
 * E-invoicing orchestration (Slovakia eFaktura / Czechia ISDOC).
 *
 * Skeleton: routing decisions, D1 ledger, UBL XML draft, admin settings.
 * Peppol AP transmission and ISDOC export are queued for a follow-up PR.
 */

import { requireAuth, requireRole } from './auth.js'
import { getSetting, setSettings } from './settingsStore.js'

export type SellerJurisdiction = 'SK' | 'CZ'
export type InvoiceFormat = 'peppol_ubl' | 'isdoc' | 'pdf_archive' | 'none'
export type InvoiceRouting = 'peppol_ap' | 'isdoc_delivery' | 'email_pdf' | 'deferred' | 'not_required'
export type InvoiceStatus = 'draft' | 'queued' | 'sent' | 'delivered' | 'failed' | 'not_required'

export interface BuyerProfile {
  country: string | null
  vatId: string | null
  name: string | null
  email: string | null
  address: {
    line1?: string | null
    city?: string | null
    postalCode?: string | null
    country?: string | null
  } | null
  peppolEndpointId?: string | null
  peppolSchemeId?: string | null
  isBusiness: boolean
}

export interface SellerProfile {
  legalName: string
  vatId: string
  companyId: string
  addressLine1: string
  addressCity: string
  addressPostalCode: string
  addressCountry: string
  jurisdiction: SellerJurisdiction
  peppolParticipantId: string
  peppolSchemeId: string
}

export interface RoutingContext {
  now: Date
  skVoluntaryEnabled: boolean
  einvoicingEnabled: boolean
}

export interface RoutingDecision {
  format: InvoiceFormat
  routing: InvoiceRouting
  mandateApplies: boolean
  reason: string
}

export interface InvoiceLineItem {
  description: string
  quantity: number
  netAmountCents: number
  vatRatePercent: number | null
}

export interface InvoiceDraftInput {
  userId: string
  stripeInvoiceId: string | null
  stripePaymentIntentId: string | null
  stripeSubscriptionId: string | null
  planType: string | null
  issueDate: string
  currency: string
  netAmountCents: number
  taxAmountCents: number
  grossAmountCents: number
  vatRatePercent: number | null
  buyer: BuyerProfile
  seller: SellerProfile
  lineItems: InvoiceLineItem[]
  idempotencyKey: string
}

const SK_MANDATORY_DATE = new Date('2027-01-01T00:00:00.000Z')
const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
])

const PEPPOL_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'
const PEPPOL_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function normalizeCountryCode(value: unknown): string | null {
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return null
  if (raw.length === 2) return raw
  return null
}

function hasBusinessVatId(vatId: string | null | undefined): boolean {
  const normalized = String(vatId ?? '').trim()
  return normalized.length >= 4
}

export function isEuCountry(country: string | null | undefined): boolean {
  const code = normalizeCountryCode(country)
  return code ? EU_COUNTRY_CODES.has(code) : false
}

export function isSkDomesticB2B(
  buyer: Pick<BuyerProfile, 'country' | 'vatId' | 'isBusiness'>,
  seller: Pick<SellerProfile, 'jurisdiction'>,
): boolean {
  if (seller.jurisdiction !== 'SK') return false
  const country = normalizeCountryCode(buyer.country)
  return country === 'SK' && buyer.isBusiness && hasBusinessVatId(buyer.vatId)
}

export function isCzDomesticB2B(
  buyer: Pick<BuyerProfile, 'country' | 'vatId' | 'isBusiness'>,
  seller: Pick<SellerProfile, 'jurisdiction'>,
): boolean {
  if (seller.jurisdiction !== 'CZ') return false
  const country = normalizeCountryCode(buyer.country)
  return country === 'CZ' && buyer.isBusiness && hasBusinessVatId(buyer.vatId)
}

/**
 * Decide invoice format and routing from buyer/seller profiles and legal timelines.
 */
export function resolveInvoiceRouting(
  buyer: BuyerProfile,
  seller: SellerProfile,
  context: RoutingContext,
): RoutingDecision {
  if (!context.einvoicingEnabled) {
    return {
      format: 'none',
      routing: 'not_required',
      mandateApplies: false,
      reason: 'E-invoicing disabled in admin settings.',
    }
  }

  const buyerCountry = normalizeCountryCode(buyer.country)
  const isB2C = !buyer.isBusiness || !hasBusinessVatId(buyer.vatId)

  if (isB2C) {
    return {
      format: 'pdf_archive',
      routing: 'email_pdf',
      mandateApplies: false,
      reason: 'B2C — structured e-invoice not mandated in SK/CZ; archive PDF for accounting.',
    }
  }

  if (isSkDomesticB2B(buyer, seller)) {
    const mandatory = context.now >= SK_MANDATORY_DATE
    const voluntary = context.skVoluntaryEnabled && context.now < SK_MANDATORY_DATE
    if (mandatory || voluntary) {
      return {
        format: 'peppol_ubl',
        routing: 'peppol_ap',
        mandateApplies: mandatory,
        reason: mandatory
          ? 'SK domestic B2B — Law 385/2025 mandatory Peppol EN 16931 (UBL 2.1) from 2027-01-01.'
          : 'SK domestic B2B — voluntary Peppol phase before 2027-01-01.',
      }
    }
    return {
      format: 'pdf_archive',
      routing: 'deferred',
      mandateApplies: false,
      reason: 'SK domestic B2B before mandatory date; enable einvoicing_sk_voluntary_enabled to route via Peppol.',
    }
  }

  if (isCzDomesticB2B(buyer, seller)) {
    return {
      format: 'isdoc',
      routing: 'isdoc_delivery',
      mandateApplies: false,
      reason: 'CZ domestic B2B — ISDOC/EN 16931 voluntary (buyer consent); no B2B mandate until EU ViDA (~2030).',
    }
  }

  if (isEuCountry(buyerCountry)) {
    return {
      format: 'peppol_ubl',
      routing: 'deferred',
      mandateApplies: false,
      reason: 'EU cross-border B2B — Peppol EN 16931 recommended; SK cross-border mandate from 2030 (ViDA).',
    }
  }

  return {
    format: 'pdf_archive',
    routing: 'email_pdf',
    mandateApplies: false,
    reason: 'Non-EU buyer — structured EU e-invoice not required; PDF archive only.',
  }
}

export function formatInvoiceNumber(prefix: string, jurisdiction: string, year: number, sequence: number): string {
  const safePrefix = String(prefix || 'VMP').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'VMP'
  const safeJurisdiction = String(jurisdiction || 'XX').trim().toUpperCase().slice(0, 2) || 'XX'
  return `${safePrefix}-${safeJurisdiction}-${year}-${String(sequence).padStart(6, '0')}`
}

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildPeppolUblSkeleton(input: {
  invoiceNumber: string
  issueDate: string
  currency: string
  seller: SellerProfile
  buyer: BuyerProfile
  lineItems: InvoiceLineItem[]
  netAmountCents: number
  taxAmountCents: number
  grossAmountCents: number
  vatRatePercent: number | null
}): string {
  const taxCategory = (input.vatRatePercent ?? 0) > 0 ? 'S' : 'Z'
  const taxPercent = input.vatRatePercent ?? 0
  const lines = input.lineItems.map((line, index) => {
    const lineNet = (line.netAmountCents / 100).toFixed(2)
    const lineTax = ((line.netAmountCents * (line.vatRatePercent ?? 0)) / 10000).toFixed(2)
    const lineGross = ((line.netAmountCents + Number(lineTax) * 100) / 100).toFixed(2)
    return `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(input.currency)}">${lineNet}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${line.vatRatePercent ?? 0}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(input.currency)}">${lineNet}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`
  }).join('')

  const net = (input.netAmountCents / 100).toFixed(2)
  const tax = (input.taxAmountCents / 100).toFixed(2)
  const gross = (input.grossAmountCents / 100).toFixed(2)
  const buyerEndpoint = input.buyer.peppolEndpointId || input.buyer.vatId || input.buyer.email || 'unknown'
  const buyerScheme = input.buyer.peppolSchemeId || '9935'
  const sellerEndpoint = input.seller.peppolParticipantId || input.seller.vatId || input.seller.companyId
  const sellerScheme = input.seller.peppolSchemeId || '9935'

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${PEPPOL_CUSTOMIZATION_ID}</cbc:CustomizationID>
  <cbc:ProfileID>${PEPPOL_PROFILE_ID}</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(input.issueDate)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(input.currency)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXml(input.buyer.email || input.invoiceNumber)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="${escapeXml(sellerScheme)}">${escapeXml(sellerEndpoint)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${escapeXml(input.seller.legalName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(input.seller.addressLine1)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(input.seller.addressCity)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(input.seller.addressPostalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${escapeXml(input.seller.addressCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(input.seller.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(input.seller.legalName)}</cbc:RegistrationName>
        <cbc:CompanyID>${escapeXml(input.seller.companyId)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="${escapeXml(buyerScheme)}">${escapeXml(buyerEndpoint)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${escapeXml(input.buyer.name || input.buyer.email || 'Customer')}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(input.buyer.address?.line1 || '')}</cbc:StreetName>
        <cbc:CityName>${escapeXml(input.buyer.address?.city || '')}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(input.buyer.address?.postalCode || '')}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${escapeXml(buyerCountryCode(input.buyer) || '')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${input.buyer.vatId ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(input.buyer.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(input.buyer.name || input.buyer.email || 'Customer')}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(input.currency)}">${tax}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(input.currency)}">${net}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(input.currency)}">${tax}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${taxPercent}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(input.currency)}">${net}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(input.currency)}">${net}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(input.currency)}">${gross}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(input.currency)}">${gross}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>`
}

function buyerCountryCode(buyer: BuyerProfile): string | null {
  return normalizeCountryCode(buyer.address?.country || buyer.country)
}

async function loadSellerProfile(env: any): Promise<SellerProfile> {
  const keys = [
    'seller_legal_name',
    'seller_vat_id',
    'seller_company_id',
    'seller_address_line1',
    'seller_address_city',
    'seller_address_postal_code',
    'seller_address_country',
    'seller_jurisdiction',
    'seller_peppol_participant_id',
    'seller_peppol_scheme_id',
  ] as const
  const values = await Promise.all(keys.map((key) => getSetting(env, key)))
  const jurisdiction = String(values[7] ?? 'SK').trim().toUpperCase() === 'CZ' ? 'CZ' : 'SK'
  return {
    legalName: String(values[0] ?? ''),
    vatId: String(values[1] ?? ''),
    companyId: String(values[2] ?? ''),
    addressLine1: String(values[3] ?? ''),
    addressCity: String(values[4] ?? ''),
    addressPostalCode: String(values[5] ?? ''),
    addressCountry: normalizeCountryCode(values[6]) || jurisdiction,
    jurisdiction,
    peppolParticipantId: String(values[8] ?? ''),
    peppolSchemeId: String(values[9] ?? '9935'),
  }
}

async function nextInvoiceSequence(db: any, jurisdiction: string, year: number): Promise<number> {
  await db.prepare(`
    INSERT INTO einvoicing_sequences (jurisdiction, year, last_number, updated_at)
    VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(jurisdiction, year) DO NOTHING
  `).bind(jurisdiction, year).run()

  await db.prepare(`
    UPDATE einvoicing_sequences
    SET last_number = last_number + 1, updated_at = CURRENT_TIMESTAMP
    WHERE jurisdiction = ? AND year = ?
  `).bind(jurisdiction, year).run()

  const row = await db.prepare(`
    SELECT last_number FROM einvoicing_sequences WHERE jurisdiction = ? AND year = ? LIMIT 1
  `).bind(jurisdiction, year).first()
  return Number(row?.last_number ?? 1)
}

function centsFromStripeAmount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function isoDateFromUnixSeconds(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString().slice(0, 10)
  return new Date(n * 1000).toISOString().slice(0, 10)
}

function deriveVatRatePercent(netCents: number, taxCents: number): number | null {
  if (netCents <= 0 || taxCents <= 0) return taxCents > 0 ? null : 0
  const rate = (taxCents / netCents) * 100
  return Math.round(rate * 100) / 100
}

export function extractBuyerFromStripeInvoice(stripeInvoice: any, fallbackEmail?: string | null): BuyerProfile {
  const customerAddress = stripeInvoice?.customer_address && typeof stripeInvoice.customer_address === 'object'
    ? stripeInvoice.customer_address
    : null
  const taxIds = Array.isArray(stripeInvoice?.customer_tax_ids) ? stripeInvoice.customer_tax_ids : []
  const primaryTax = taxIds.find((entry: any) => entry?.value) ?? stripeInvoice?.account_tax_ids?.[0]
  const vatId = typeof primaryTax?.value === 'string'
    ? primaryTax.value
    : typeof stripeInvoice?.customer_tax_id === 'string'
      ? stripeInvoice.customer_tax_id
      : null
  const country = normalizeCountryCode(
    customerAddress?.country
    || stripeInvoice?.customer_shipping?.address?.country
    || stripeInvoice?.account_country,
  )
  const name = String(
    stripeInvoice?.customer_name
    || stripeInvoice?.customer_shipping?.name
    || '',
  ).trim() || null
  const email = String(stripeInvoice?.customer_email || fallbackEmail || '').trim() || null
  const isBusiness = hasBusinessVatId(vatId) || Boolean(name && name !== email)

  return {
    country,
    vatId,
    name,
    email,
    address: customerAddress
      ? {
        line1: customerAddress.line1 ?? null,
        city: customerAddress.city ?? null,
        postalCode: customerAddress.postal_code ?? null,
        country: normalizeCountryCode(customerAddress.country),
      }
      : null,
    peppolEndpointId: vatId,
    peppolSchemeId: country === 'SK' || country === 'CZ' ? '9935' : null,
    isBusiness,
  }
}

export function buildLineItemsFromStripeInvoice(stripeInvoice: any, planType: string | null): InvoiceLineItem[] {
  const lines = Array.isArray(stripeInvoice?.lines?.data) ? stripeInvoice.lines.data : []
  if (lines.length === 0) {
    const net = centsFromStripeAmount(stripeInvoice?.subtotal ?? stripeInvoice?.total_excluding_tax)
    const tax = centsFromStripeAmount(stripeInvoice?.tax ?? 0)
    return [{
      description: planType ? `VMP subscription (${planType})` : 'VMP subscription',
      quantity: 1,
      netAmountCents: net,
      vatRatePercent: deriveVatRatePercent(net, tax),
    }]
  }

  return lines.map((line: any) => {
    const net = centsFromStripeAmount(line?.amount_excluding_tax ?? line?.amount)
    const taxAmounts = Array.isArray(line?.tax_amounts) ? line.tax_amounts : []
    const tax = taxAmounts.reduce((sum: number, entry: any) => sum + centsFromStripeAmount(entry?.amount), 0)
    const description = String(line?.description || line?.price?.nickname || 'VMP subscription').trim()
    return {
      description,
      quantity: Number(line?.quantity ?? 1) || 1,
      netAmountCents: net,
      vatRatePercent: deriveVatRatePercent(net, tax),
    }
  })
}

export async function createInvoiceFromStripe(env: any, params: {
  userId: string
  stripeInvoice: any
  planType?: string | null
  userEmail?: string | null
}): Promise<{ created: boolean, invoiceId: string | null, status: InvoiceStatus | null, reason?: string }> {
  const db = getDb(env)
  const stripeInvoice = params.stripeInvoice
  const stripeInvoiceId = String(stripeInvoice?.id ?? '').trim()
  if (!stripeInvoiceId) {
    return { created: false, invoiceId: null, status: null, reason: 'missing_stripe_invoice_id' }
  }

  const existing = await db.prepare(
    'SELECT id, status FROM einvoices WHERE stripe_invoice_id = ? LIMIT 1',
  ).bind(stripeInvoiceId).first()
  if (existing?.id) {
    return { created: false, invoiceId: String(existing.id), status: String(existing.status) as InvoiceStatus }
  }

  const enabled = String(await getSetting(env, 'einvoicing_enabled', { defaultValue: '0' })) === '1'
  const skVoluntaryEnabled = String(await getSetting(env, 'einvoicing_sk_voluntary_enabled', { defaultValue: '0' })) === '1'
  const seller = await loadSellerProfile(env)
  const buyer = extractBuyerFromStripeInvoice(stripeInvoice, params.userEmail)
  const routing = resolveInvoiceRouting(buyer, seller, {
    now: new Date(),
    skVoluntaryEnabled,
    einvoicingEnabled: enabled,
  })

  const issueDate = isoDateFromUnixSeconds(stripeInvoice?.status_transitions?.paid_at || stripeInvoice?.created)
  const year = Number(issueDate.slice(0, 4))
  const prefix = String(await getSetting(env, 'einvoicing_invoice_prefix', { defaultValue: 'VMP' }))
  const sequence = await nextInvoiceSequence(db, seller.jurisdiction, year)
  const invoiceNumber = formatInvoiceNumber(prefix, seller.jurisdiction, year, sequence)
  const netAmountCents = centsFromStripeAmount(stripeInvoice?.subtotal ?? stripeInvoice?.total_excluding_tax)
  const taxAmountCents = centsFromStripeAmount(stripeInvoice?.tax ?? 0)
  const grossAmountCents = centsFromStripeAmount(stripeInvoice?.total ?? (netAmountCents + taxAmountCents))
  const currency = String(stripeInvoice?.currency || 'eur').toUpperCase()
  const lineItems = buildLineItemsFromStripeInvoice(stripeInvoice, params.planType ?? null)
  const vatRatePercent = deriveVatRatePercent(netAmountCents, taxAmountCents)
  const invoiceId = crypto.randomUUID()
  const idempotencyKey = `stripe:${stripeInvoiceId}`

  let xmlPayload: string | null = null
  let xmlR2Key: string | null = null
  if (routing.format === 'peppol_ubl') {
    xmlPayload = buildPeppolUblSkeleton({
      invoiceNumber,
      issueDate,
      currency,
      seller,
      buyer,
      lineItems,
      netAmountCents,
      taxAmountCents,
      grossAmountCents,
      vatRatePercent,
    })
    xmlR2Key = `einvoices/${invoiceId}/invoice.xml`
    if (env.BUCKET && xmlPayload) {
      await env.BUCKET.put(xmlR2Key, xmlPayload, {
        httpMetadata: { contentType: 'application/xml' },
      })
    }
  }

  const initialStatus: InvoiceStatus = routing.routing === 'not_required'
    ? 'not_required'
    : routing.format === 'none'
      ? 'not_required'
      : seller.legalName && seller.vatId
        ? (routing.routing === 'peppol_ap' || routing.routing === 'isdoc_delivery' ? 'queued' : 'draft')
        : 'draft'

  await db.prepare(`
    INSERT INTO einvoices (
      id, invoice_number, user_id, stripe_invoice_id, stripe_payment_intent_id, stripe_subscription_id,
      plan_type, issue_date, currency, net_amount_cents, tax_amount_cents, gross_amount_cents, vat_rate_percent,
      buyer_country, buyer_vat_id, buyer_name, buyer_email, buyer_address_json,
      buyer_peppol_endpoint_id, buyer_peppol_scheme_id,
      seller_jurisdiction, format, routing, status, mandate_applies,
      xml_payload_r2_key, idempotency_key, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `).bind(
    invoiceId,
    invoiceNumber,
    params.userId,
    stripeInvoiceId,
    typeof stripeInvoice?.payment_intent === 'string' ? stripeInvoice.payment_intent : stripeInvoice?.payment_intent?.id ?? null,
    typeof stripeInvoice?.subscription === 'string' ? stripeInvoice.subscription : stripeInvoice?.subscription?.id ?? null,
    params.planType ?? null,
    issueDate,
    currency,
    netAmountCents,
    taxAmountCents,
    grossAmountCents,
    vatRatePercent,
    buyer.country,
    buyer.vatId,
    buyer.name,
    buyer.email,
    buyer.address ? JSON.stringify(buyer.address) : null,
    buyer.peppolEndpointId ?? null,
    buyer.peppolSchemeId ?? null,
    seller.jurisdiction,
    routing.format,
    routing.routing,
    initialStatus,
    routing.mandateApplies ? 1 : 0,
    xmlR2Key,
    idempotencyKey,
  ).run()

  return { created: true, invoiceId, status: initialStatus, reason: routing.reason }
}

export async function handleStripeInvoicePaid(env: any, db: any, stripeInvoice: any, userId: string) {
  try {
    const user = await db.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(userId).first()
    const sub = await db.prepare(
      'SELECT plan_type FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).bind(userId).first()
    await createInvoiceFromStripe(env, {
      userId,
      stripeInvoice,
      planType: sub?.plan_type ? String(sub.plan_type) : null,
      userEmail: user?.email ? String(user.email) : null,
    })
  } catch (err) {
    console.error('[eInvoicing] handleStripeInvoicePaid failed', { userId, err })
  }
}

const ADMIN_SETTING_KEYS = [
  'einvoicing_enabled',
  'einvoicing_sk_voluntary_enabled',
  'einvoicing_isdoc_enabled',
  'einvoicing_b2c_mode',
  'einvoicing_invoice_prefix',
  'seller_legal_name',
  'seller_vat_id',
  'seller_company_id',
  'seller_address_line1',
  'seller_address_city',
  'seller_address_postal_code',
  'seller_address_country',
  'seller_jurisdiction',
  'seller_peppol_participant_id',
  'seller_peppol_scheme_id',
  'peppol_access_point_provider',
  'peppol_access_point_api_url',
  'peppol_access_point_sender_id',
] as const

export async function handleAdminEInvoicingSettings(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method === 'GET') {
    const values = await Promise.all(ADMIN_SETTING_KEYS.map((key) => getSetting(env, key)))
    const byKey = Object.fromEntries(ADMIN_SETTING_KEYS.map((key, index) => [key, values[index] ?? '']))
    return jsonResponse({
      enabled: byKey.einvoicing_enabled === '1',
      skVoluntaryEnabled: byKey.einvoicing_sk_voluntary_enabled === '1',
      isdocEnabled: byKey.einvoicing_isdoc_enabled === '1',
      b2cMode: byKey.einvoicing_b2c_mode || 'pdf_archive',
      invoicePrefix: byKey.einvoicing_invoice_prefix || 'VMP',
      seller: {
        legalName: byKey.seller_legal_name,
        vatId: byKey.seller_vat_id,
        companyId: byKey.seller_company_id,
        addressLine1: byKey.seller_address_line1,
        addressCity: byKey.seller_address_city,
        addressPostalCode: byKey.seller_address_postal_code,
        addressCountry: byKey.seller_address_country,
        jurisdiction: byKey.seller_jurisdiction === 'CZ' ? 'CZ' : 'SK',
        peppolParticipantId: byKey.seller_peppol_participant_id,
        peppolSchemeId: byKey.seller_peppol_scheme_id || '9935',
      },
      peppol: {
        accessPointProvider: byKey.peppol_access_point_provider,
        accessPointApiUrl: byKey.peppol_access_point_api_url,
        accessPointSenderId: byKey.peppol_access_point_sender_id,
      },
      legalTimeline: {
        skMandatoryB2bDate: '2027-01-01',
        skVoluntaryFrom: '2026-05-15',
        czB2bMandate: 'none_announced',
        euCrossBorderViDA: '2030-07-01',
      },
    }, 200, corsHeaders)
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
  }

  const updates: [string, string][] = []
  if ('enabled' in body) updates.push(['einvoicing_enabled', body.enabled ? '1' : '0'])
  if ('skVoluntaryEnabled' in body) updates.push(['einvoicing_sk_voluntary_enabled', body.skVoluntaryEnabled ? '1' : '0'])
  if ('isdocEnabled' in body) updates.push(['einvoicing_isdoc_enabled', body.isdocEnabled ? '1' : '0'])
  if ('b2cMode' in body) {
    const mode = String(body.b2cMode ?? '').trim()
    if (!['pdf_archive', 'none'].includes(mode)) {
      return jsonResponse({ error: 'b2cMode must be pdf_archive or none' }, 400, corsHeaders)
    }
    updates.push(['einvoicing_b2c_mode', mode])
  }
  if ('invoicePrefix' in body) {
    updates.push(['einvoicing_invoice_prefix', String(body.invoicePrefix ?? 'VMP').trim().slice(0, 16)])
  }

  const seller = body.seller
  if (seller && typeof seller === 'object') {
    if ('legalName' in seller) updates.push(['seller_legal_name', String(seller.legalName ?? '').trim()])
    if ('vatId' in seller) updates.push(['seller_vat_id', String(seller.vatId ?? '').trim()])
    if ('companyId' in seller) updates.push(['seller_company_id', String(seller.companyId ?? '').trim()])
    if ('addressLine1' in seller) updates.push(['seller_address_line1', String(seller.addressLine1 ?? '').trim()])
    if ('addressCity' in seller) updates.push(['seller_address_city', String(seller.addressCity ?? '').trim()])
    if ('addressPostalCode' in seller) updates.push(['seller_address_postal_code', String(seller.addressPostalCode ?? '').trim()])
    if ('addressCountry' in seller) updates.push(['seller_address_country', String(seller.addressCountry ?? '').trim().toUpperCase().slice(0, 2)])
    if ('jurisdiction' in seller) {
      const jurisdiction = String(seller.jurisdiction ?? 'SK').trim().toUpperCase()
      updates.push(['seller_jurisdiction', jurisdiction === 'CZ' ? 'CZ' : 'SK'])
    }
    if ('peppolParticipantId' in seller) updates.push(['seller_peppol_participant_id', String(seller.peppolParticipantId ?? '').trim()])
    if ('peppolSchemeId' in seller) updates.push(['seller_peppol_scheme_id', String(seller.peppolSchemeId ?? '9935').trim()])
  }

  const peppol = body.peppol
  if (peppol && typeof peppol === 'object') {
    if ('accessPointProvider' in peppol) updates.push(['peppol_access_point_provider', String(peppol.accessPointProvider ?? '').trim()])
    if ('accessPointApiUrl' in peppol) updates.push(['peppol_access_point_api_url', String(peppol.accessPointApiUrl ?? '').trim()])
    if ('accessPointSenderId' in peppol) updates.push(['peppol_access_point_sender_id', String(peppol.accessPointSenderId ?? '').trim()])
  }

  if (!updates.length) {
    return jsonResponse({ error: 'No supported fields to update' }, 400, corsHeaders)
  }

  await setSettings(env, updates)
  return jsonResponse({ ok: true }, 200, corsHeaders)
}

function mapInvoiceRow(row: any) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    userId: row.user_id,
    stripeInvoiceId: row.stripe_invoice_id,
    planType: row.plan_type,
    issueDate: row.issue_date,
    currency: row.currency,
    netAmountCents: row.net_amount_cents,
    taxAmountCents: row.tax_amount_cents,
    grossAmountCents: row.gross_amount_cents,
    vatRatePercent: row.vat_rate_percent,
    buyerCountry: row.buyer_country,
    buyerVatId: row.buyer_vat_id,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    sellerJurisdiction: row.seller_jurisdiction,
    format: row.format,
    routing: row.routing,
    status: row.status,
    mandateApplies: Boolean(row.mandate_applies),
    xmlPayloadR2Key: row.xml_payload_r2_key,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function handleAdminEInvoices(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const db = getDb(env)
  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200)
  const status = String(url.searchParams.get('status') ?? '').trim()

  let query = `
    SELECT * FROM einvoices
    ${status ? 'WHERE status = ?' : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `
  const result = status
    ? await db.prepare(query).bind(status, limit).all()
    : await db.prepare(query).bind(limit).all()

  return jsonResponse({
    invoices: (result?.results ?? []).map(mapInvoiceRow),
  }, 200, corsHeaders)
}

export async function handleAdminEInvoiceById(request: any, env: any, corsHeaders: any, invoiceId: string) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM einvoices WHERE id = ? LIMIT 1').bind(invoiceId).first()
  if (!row) return jsonResponse({ error: 'Invoice not found' }, 404, corsHeaders)

  let xmlPreview: string | null = null
  if (row.xml_payload_r2_key && env.BUCKET) {
    const object = await env.BUCKET.get(String(row.xml_payload_r2_key))
    if (object) xmlPreview = await object.text()
  }

  return jsonResponse({
    invoice: mapInvoiceRow(row),
    xmlPreview,
  }, 200, corsHeaders)
}

export async function handleAccountInvoices(request: any, env: any, corsHeaders: any) {
  let user
  try {
    user = await requireAuth(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const db = getDb(env)
  const result = await db.prepare(`
    SELECT id, invoice_number, issue_date, currency, gross_amount_cents, status, format, created_at
    FROM einvoices
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(user.sub).all()

  return jsonResponse({
    invoices: (result?.results ?? []).map((row: any) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      currency: row.currency,
      grossAmountCents: row.gross_amount_cents,
      status: row.status,
      format: row.format,
      createdAt: row.created_at,
    })),
  }, 200, corsHeaders)
}
