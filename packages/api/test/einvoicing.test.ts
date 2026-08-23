import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildIsdocSkeleton,
  buildPeppolUblSkeleton,
  extractBuyerFromStripeInvoice,
  formatInvoiceNumber,
  hasMixedVatRates,
  isCzDomesticB2B,
  isSkDomesticB2B,
  nationalCompanyIdFromVat,
  resolveInvoiceRouting,
  SK_VOLUNTARY_FROM_DATE,
} from '../src/eInvoicing.js';
import { deliverIsdocInvoice, transmitPeppolUbl } from '../src/einvoiceDelivery.js';
import { resetSettingsCacheForTests } from '../src/settingsStore.js';

const sellerSk = {
  legalName: 'VMP s.r.o.',
  vatId: 'SK2023456789',
  companyId: '12345678',
  addressLine1: 'Hlavná 1',
  addressCity: 'Bratislava',
  addressPostalCode: '81101',
  addressCountry: 'SK',
  jurisdiction: 'SK' as const,
  peppolParticipantId: '9935:sk2023456789',
  peppolSchemeId: '9935',
};

const sellerCz = {
  ...sellerSk,
  jurisdiction: 'CZ' as const,
  addressCountry: 'CZ',
  vatId: 'CZ12345678',
};

const skB2bBuyer = {
  country: 'SK',
  vatId: 'SK2023456789',
  name: 'Buyer s.r.o.',
  email: 'buyer@example.com',
  address: null,
  isBusiness: true,
};

function routingContext(
  overrides: Partial<{
    now: Date;
    skVoluntaryEnabled: boolean;
    einvoicingEnabled: boolean;
    isdocEnabled: boolean;
    b2cMode: 'pdf_archive' | 'none';
  }> = {},
) {
  return {
    now: new Date('2027-06-01'),
    skVoluntaryEnabled: false,
    einvoicingEnabled: true,
    isdocEnabled: true,
    b2cMode: 'pdf_archive' as const,
    skVoluntaryFrom: SK_VOLUNTARY_FROM_DATE,
    ...overrides,
  };
}

describe('resolveInvoiceRouting', () => {
  it('returns not_required when e-invoicing is disabled', () => {
    const decision = resolveInvoiceRouting(
      skB2bBuyer,
      sellerSk,
      routingContext({ einvoicingEnabled: false }),
    );
    assert.equal(decision.routing, 'not_required');
    assert.equal(decision.format, 'none');
  });

  it('routes SK domestic B2B to Peppol when mandatory date reached', () => {
    const decision = resolveInvoiceRouting(
      skB2bBuyer,
      sellerSk,
      routingContext({ now: new Date('2027-06-01') }),
    );
    assert.equal(decision.format, 'peppol_ubl');
    assert.equal(decision.routing, 'peppol_ap');
    assert.equal(decision.mandateApplies, true);
  });

  it('defers SK B2B before 2027 unless voluntary flag is on and voluntary date reached', () => {
    const beforeMandatory = resolveInvoiceRouting(
      skB2bBuyer,
      sellerSk,
      routingContext({ now: new Date('2026-10-01'), skVoluntaryEnabled: false }),
    );
    assert.equal(beforeMandatory.routing, 'deferred');

    const voluntary = resolveInvoiceRouting(
      skB2bBuyer,
      sellerSk,
      routingContext({ now: new Date('2026-10-01'), skVoluntaryEnabled: true }),
    );
    assert.equal(voluntary.routing, 'peppol_ap');
    assert.equal(voluntary.mandateApplies, false);
  });

  it('defers SK voluntary routing before skVoluntaryFrom even when flag is enabled', () => {
    const decision = resolveInvoiceRouting(
      skB2bBuyer,
      sellerSk,
      routingContext({ now: new Date('2026-03-01'), skVoluntaryEnabled: true }),
    );
    assert.equal(decision.routing, 'deferred');
    assert.equal(decision.format, 'pdf_archive');
  });

  it('routes CZ domestic B2B to ISDOC when isdocEnabled', () => {
    const decision = resolveInvoiceRouting(
      {
        country: 'CZ',
        vatId: 'CZ12345678',
        name: 'Buyer s.r.o.',
        email: 'buyer@example.com',
        address: null,
        isBusiness: true,
      },
      sellerCz,
      routingContext({ now: new Date('2026-10-01'), isdocEnabled: true }),
    );
    assert.equal(decision.format, 'isdoc');
    assert.equal(decision.routing, 'isdoc_delivery');
    assert.equal(decision.mandateApplies, false);
  });

  it('defers CZ domestic B2B when isdocEnabled is false', () => {
    const decision = resolveInvoiceRouting(
      {
        country: 'CZ',
        vatId: 'CZ12345678',
        name: 'Buyer s.r.o.',
        email: 'buyer@example.com',
        address: null,
        isBusiness: true,
      },
      sellerCz,
      routingContext({ now: new Date('2026-10-01'), isdocEnabled: false }),
    );
    assert.equal(decision.format, 'pdf_archive');
    assert.equal(decision.routing, 'deferred');
  });

  it('archives PDF for B2C consumers when b2cMode is pdf_archive', () => {
    const decision = resolveInvoiceRouting(
      {
        country: 'SK',
        vatId: null,
        name: 'Jane Doe',
        email: 'jane@example.com',
        address: null,
        isBusiness: false,
      },
      sellerSk,
      routingContext({ b2cMode: 'pdf_archive' }),
    );
    assert.equal(decision.format, 'pdf_archive');
    assert.equal(decision.routing, 'email_pdf');
    assert.equal(decision.mandateApplies, false);
  });

  it('skips B2C invoicing when b2cMode is none', () => {
    const decision = resolveInvoiceRouting(
      {
        country: 'SK',
        vatId: null,
        name: 'Jane Doe',
        email: 'jane@example.com',
        address: null,
        isBusiness: false,
      },
      sellerSk,
      routingContext({ b2cMode: 'none' }),
    );
    assert.equal(decision.format, 'none');
    assert.equal(decision.routing, 'not_required');
  });
});

describe('domestic B2B helpers', () => {
  it('detects SK domestic B2B', () => {
    assert.equal(
      isSkDomesticB2B({ country: 'SK', vatId: 'SK123', isBusiness: true }, sellerSk),
      true,
    );
    assert.equal(
      isSkDomesticB2B({ country: 'CZ', vatId: 'CZ123', isBusiness: true }, sellerSk),
      false,
    );
  });

  it('detects CZ domestic B2B', () => {
    assert.equal(
      isCzDomesticB2B({ country: 'CZ', vatId: 'CZ123', isBusiness: true }, sellerCz),
      true,
    );
  });
});

describe('formatInvoiceNumber', () => {
  it('formats padded sequence with jurisdiction', () => {
    assert.equal(formatInvoiceNumber('VMP', 'SK', 2027, 42), 'VMP-SK-2027-000042');
  });
});

describe('extractBuyerFromStripeInvoice', () => {
  it('extracts VAT ID and country from Stripe invoice payload', () => {
    const buyer = extractBuyerFromStripeInvoice({
      customer_email: 'buyer@example.com',
      customer_name: 'Buyer s.r.o.',
      customer_address: {
        line1: 'Ulica 1',
        city: 'Bratislava',
        postal_code: '81101',
        country: 'SK',
      },
      customer_tax_ids: [{ value: 'SK2023456789' }],
    });
    assert.equal(buyer.country, 'SK');
    assert.equal(buyer.vatId, 'SK2023456789');
    assert.equal(buyer.isBusiness, true);
  });

  it('does not use issuer account_tax_ids or account_country fallbacks', () => {
    const buyer = extractBuyerFromStripeInvoice({
      customer_email: 'buyer@example.com',
      account_tax_ids: [{ value: 'SK9999999999' }],
      account_country: 'SK',
    });
    assert.equal(buyer.vatId, null);
    assert.equal(buyer.country, null);
  });
});

describe('buildPeppolUblSkeleton', () => {
  it('includes Peppol customization and invoice identifiers', () => {
    const xml = buildPeppolUblSkeleton({
      invoiceNumber: 'VMP-SK-2027-000001',
      issueDate: '2027-01-15',
      currency: 'EUR',
      seller: sellerSk,
      buyer: {
        country: 'SK',
        vatId: 'SK2023456789',
        name: 'Buyer s.r.o.',
        email: 'buyer@example.com',
        address: { line1: 'Ulica 2', city: 'Košice', postalCode: '04001', country: 'SK' },
        isBusiness: true,
      },
      lineItems: [
        {
          description: 'Monthly subscription',
          quantity: 1,
          netAmountCents: 1000,
          vatRatePercent: 20,
        },
      ],
      netAmountCents: 1000,
      taxAmountCents: 200,
      grossAmountCents: 1200,
      vatRatePercent: 20,
    });
    assert.match(xml, /VMP-SK-2027-000001/);
    assert.match(xml, /urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
    assert.match(xml, /Monthly subscription/);
  });

  it('uses per-unit PriceAmount while LineExtensionAmount stays line total', () => {
    const xml = buildPeppolUblSkeleton({
      invoiceNumber: 'VMP-SK-2027-000002',
      issueDate: '2027-01-15',
      currency: 'EUR',
      seller: sellerSk,
      buyer: {
        country: 'SK',
        vatId: 'SK2023456789',
        name: 'Buyer s.r.o.',
        email: 'buyer@example.com',
        address: null,
        isBusiness: true,
      },
      lineItems: [{ description: 'Bundle', quantity: 4, netAmountCents: 4000, vatRatePercent: 20 }],
      netAmountCents: 4000,
      taxAmountCents: 800,
      grossAmountCents: 4800,
      vatRatePercent: 20,
    });
    assert.match(xml, /<cbc:InvoicedQuantity unitCode="C62">4<\/cbc:InvoicedQuantity>/);
    assert.match(
      xml,
      /<cbc:LineExtensionAmount currencyID="EUR">40\.00<\/cbc:LineExtensionAmount>/,
    );
    assert.match(xml, /<cbc:PriceAmount currencyID="EUR">10\.00<\/cbc:PriceAmount>/);
  });

  it('rejects mixed-rate line items before XML is built', () => {
    assert.equal(
      hasMixedVatRates([
        { description: 'Standard', quantity: 1, netAmountCents: 1000, vatRatePercent: 20 },
        { description: 'Reduced', quantity: 1, netAmountCents: 500, vatRatePercent: 10 },
      ]),
      true,
    );

    assert.throws(
      () =>
        buildPeppolUblSkeleton({
          invoiceNumber: 'VMP-SK-2027-000003',
          issueDate: '2027-01-15',
          currency: 'EUR',
          seller: sellerSk,
          buyer: {
            country: 'SK',
            vatId: 'SK2023456789',
            name: 'Buyer s.r.o.',
            email: 'buyer@example.com',
            address: null,
            isBusiness: true,
          },
          lineItems: [
            { description: 'Standard plan', quantity: 1, netAmountCents: 1000, vatRatePercent: 20 },
            { description: 'Add-on', quantity: 1, netAmountCents: 500, vatRatePercent: 10 },
          ],
          netAmountCents: 1500,
          taxAmountCents: 250,
          grossAmountCents: 1750,
          vatRatePercent: 16.67,
        }),
      /mixed_vat_rates/,
    );
  });
});

describe('nationalCompanyIdFromVat', () => {
  it('strips CZ/SK prefixes', () => {
    assert.equal(nationalCompanyIdFromVat('CZ12345678', 'CZ'), '12345678');
    assert.equal(nationalCompanyIdFromVat('SK2023456789', 'SK'), '2023456789');
    assert.equal(nationalCompanyIdFromVat('12345678', 'CZ'), '12345678');
  });
});

describe('buildIsdocSkeleton', () => {
  it('emits ISDOC 6.0.2 root with parties, lines, and monetary totals', () => {
    const xml = buildIsdocSkeleton({
      invoiceId: '11111111-2222-3333-4444-555555555555',
      invoiceNumber: 'VMP-CZ-2026-000001',
      issueDate: '2026-10-01',
      currency: 'CZK',
      seller: sellerCz,
      buyer: {
        country: 'CZ',
        vatId: 'CZ12345678',
        name: 'Buyer s.r.o.',
        email: 'buyer@example.com',
        address: { line1: 'Ulice 12', city: 'Praha', postalCode: '11000', country: 'CZ' },
        isBusiness: true,
      },
      lineItems: [
        {
          description: 'Yearly subscription',
          quantity: 1,
          netAmountCents: 10000,
          vatRatePercent: 21,
        },
      ],
      netAmountCents: 10000,
      taxAmountCents: 2100,
      grossAmountCents: 12100,
      vatRatePercent: 21,
      electronicConsentReference: 'CONSENT-1',
    });
    assert.match(xml, /version="6\.0\.2"/);
    assert.match(xml, /http:\/\/isdoc\.cz\/namespace\/2013/);
    assert.match(xml, /<DocumentType>1<\/DocumentType>/);
    assert.match(xml, /VMP-CZ-2026-000001/);
    assert.match(xml, /CONSENT-1/);
    assert.match(xml, /Yearly subscription/);
    assert.match(xml, /<LocalCurrencyCode>CZK<\/LocalCurrencyCode>/);
    assert.match(xml, /<PartyIdentification>\s*<ID>12345678<\/ID>/);
    assert.match(xml, /<PayableAmount>121\.00<\/PayableAmount>/);
  });

  it('rejects mixed VAT rates', () => {
    assert.throws(
      () =>
        buildIsdocSkeleton({
          invoiceId: '11111111-2222-3333-4444-555555555555',
          invoiceNumber: 'VMP-CZ-2026-000002',
          issueDate: '2026-10-01',
          currency: 'CZK',
          seller: sellerCz,
          buyer: {
            country: 'CZ',
            vatId: 'CZ12345678',
            name: 'Buyer s.r.o.',
            email: 'buyer@example.com',
            address: null,
            isBusiness: true,
          },
          lineItems: [
            { description: 'A', quantity: 1, netAmountCents: 1000, vatRatePercent: 21 },
            { description: 'B', quantity: 1, netAmountCents: 500, vatRatePercent: 12 },
          ],
          netAmountCents: 1500,
          taxAmountCents: 270,
          grossAmountCents: 1770,
          vatRatePercent: 18,
          electronicConsentReference: 'CONSENT-1',
        }),
      /mixed_vat_rates/,
    );
  });
});

describe('einvoiceDelivery stubs', () => {
  function mockEnv(settings: Record<string, string> = {}) {
    const version = `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const allSettings: Record<string, string> = {
      settings_changed_at: version,
      ...settings,
    };
    return {
      PEPPOL_AP_API_KEY: '',
      DB: {
        prepare(_sql: string) {
          const state: { args: unknown[] } = { args: [] };
          return {
            bind(...args: unknown[]) {
              state.args = args;
              return this;
            },
            async first() {
              const key = String(state.args[0] ?? '');
              if (key in allSettings) return { value: allSettings[key] };
              return null;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      },
    };
  }

  it('Peppol stub mode returns sent without calling an AP', async () => {
    resetSettingsCacheForTests();
    const outcome = await transmitPeppolUbl(mockEnv({ einvoicing_delivery_mode: 'stub' }), {
      invoiceId: 'inv-1',
      invoiceNumber: 'VMP-SK-2027-000001',
      xml: '<Invoice/>',
      sellerParticipantId: '9935:sk2023456789',
      sellerSchemeId: '9935',
      buyerEndpointId: 'SK2023456789',
      buyerSchemeId: '9935',
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.mode, 'stub');
      assert.equal(outcome.status, 'stub_sent');
      assert.match(outcome.transmissionId, /^stub:peppol:/);
    }
  });

  it('Peppol live mode stays queued when AP credentials are missing', async () => {
    resetSettingsCacheForTests();
    const outcome = await transmitPeppolUbl(mockEnv({ einvoicing_delivery_mode: 'live' }), {
      invoiceId: 'inv-1b',
      invoiceNumber: 'VMP-SK-2027-000002',
      xml: '<Invoice/>',
      sellerParticipantId: '9935:sk2023456789',
      sellerSchemeId: '9935',
      buyerEndpointId: 'SK2023456789',
      buyerSchemeId: '9935',
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.status, 'queued');
      assert.equal(outcome.code, 'peppol_ap_not_configured');
    }
  });

  it('ISDOC stub delivery marks sent when buyer email present', async () => {
    resetSettingsCacheForTests();
    const outcome = await deliverIsdocInvoice(mockEnv({ einvoicing_delivery_mode: 'stub' }), {
      invoiceId: 'inv-2',
      invoiceNumber: 'VMP-CZ-2026-000001',
      xml: '<Invoice/>',
      buyerEmail: 'buyer@example.com',
      buyerName: 'Buyer',
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.mode, 'stub');
      assert.match(outcome.transmissionId, /^stub:isdoc:/);
    }
  });
});
