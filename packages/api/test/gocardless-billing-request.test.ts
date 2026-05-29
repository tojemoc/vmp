import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildGoCardlessBillingRequestFlowCreatePayload,
  buildGoCardlessMandateBillingRequestPayload,
  extractMandateIdFromBillingRequest,
  formatGoCardlessApiError,
  normalizeGoCardlessCurrency,
  resolveFulfilledBillingRequestMandate,
} from '../src/gocardless.js'

describe('normalizeGoCardlessCurrency', () => {
  it('defaults invalid values to EUR', () => {
    assert.equal(normalizeGoCardlessCurrency(''), 'EUR')
    assert.equal(normalizeGoCardlessCurrency('12'), 'EUR')
  })

  it('normalises valid ISO codes', () => {
    assert.equal(normalizeGoCardlessCurrency('eur'), 'EUR')
    assert.equal(normalizeGoCardlessCurrency('GBP'), 'GBP')
  })
})

describe('buildGoCardlessMandateBillingRequestPayload', () => {
  it('rejects more than three metadata keys (GoCardless API limit)', () => {
    assert.throws(
      () => buildGoCardlessMandateBillingRequestPayload({
        currency: 'EUR',
        metadata: { a: '1', b: '2', c: '3', d: '4' },
      }),
      /at most 3 keys/,
    )
  })

  it('pins mandate currency and optional creditor', () => {
    assert.deepEqual(
      buildGoCardlessMandateBillingRequestPayload({
        currency: 'EUR',
        metadata: { userId: 'u1', planType: 'monthly', checkoutToken: 'tok' },
        creditorId: 'CR123',
      }),
      {
        billing_requests: {
          mandate_request: { currency: 'EUR' },
          metadata: { userId: 'u1', planType: 'monthly', checkoutToken: 'tok' },
          links: { creditor: 'CR123' },
        },
      },
    )
  })
})

describe('buildGoCardlessBillingRequestFlowCreatePayload', () => {
  it('locks currency and prefills customer email', () => {
    const payload = buildGoCardlessBillingRequestFlowCreatePayload({
      billingRequestId: 'BRQ123',
      redirectUri: 'https://example.com/account',
      exitUri: 'https://example.com/pricing',
      customerEmail: 'alice@example.com',
    })
    assert.equal(payload.billing_request_flows.lock_currency, true)
    assert.deepEqual(payload.billing_request_flows.prefilled_customer, { email: 'alice@example.com' })
  })
})

describe('formatGoCardlessApiError', () => {
  it('maps currency_doesnt_support_functionality to actionable text', () => {
    const message = formatGoCardlessApiError({
      data: {
        error: {
          errors: [{ reason: 'currency_doesnt_support_functionality', field: 'mandate_request.currency' }],
        },
      },
    }, 'Failed to create GoCardless billing request')
    assert.match(message, /configured currency/i)
    assert.doesNotMatch(message, /currency_doesnt_support_functionality/)
  })
})

describe('extractMandateIdFromBillingRequest', () => {
  it('reads mandate from mandate_request.links', () => {
    assert.equal(
      extractMandateIdFromBillingRequest({
        mandate_request: { links: { mandate: 'MD123' } },
      }),
      'MD123',
    )
  })

  it('falls back to top-level links.mandate', () => {
    assert.equal(
      extractMandateIdFromBillingRequest({ links: { mandate: 'MD456' } }),
      'MD456',
    )
  })
})

describe('resolveFulfilledBillingRequestMandate', () => {
  const originalFetch = globalThis.fetch

  it('fulfils when billing request is ready_to_fulfil', async () => {
    const calls: string[] = []
    let fulfilIdempotencyKey = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/billing_requests/BRQ123') && init?.method !== 'POST') {
        return new Response(JSON.stringify({
          billing_requests: { id: 'BRQ123', status: 'ready_to_fulfil', mandate_request: { links: {} } },
        }), { status: 200 })
      }
      if (url.endsWith('/billing_requests/BRQ123/actions/fulfil')) {
        const headers = init?.headers
        if (headers instanceof Headers) {
          fulfilIdempotencyKey = headers.get('Idempotency-Key') ?? ''
        } else if (headers && typeof headers === 'object') {
          fulfilIdempotencyKey = String((headers as Record<string, string>)['Idempotency-Key'] ?? '')
        }
        return new Response(JSON.stringify({
          billing_requests: {
            id: 'BRQ123',
            status: 'fulfilled',
            mandate_request: { links: { mandate: 'MD789' } },
          },
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const result = await resolveFulfilledBillingRequestMandate(
        'BRQ123',
        { GOCARDLESS_ACCESS_TOKEN: 'test-token' },
        'test-idempotency-key',
      )
      assert.equal(result.ok, true)
      if (result.ok) {
        assert.equal(result.mandateId, 'MD789')
        assert.equal(result.billingRequest.status, 'fulfilled')
      }
      assert.equal(fulfilIdempotencyKey, 'test-idempotency-key')
      assert.deepEqual(calls, [
        'GET https://api.gocardless.com/billing_requests/BRQ123',
        'POST https://api.gocardless.com/billing_requests/BRQ123/actions/fulfil',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns mandate when billing request is already fulfilled', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/billing_requests/BRQ999')) {
        return new Response(JSON.stringify({
          billing_requests: {
            id: 'BRQ999',
            status: 'fulfilled',
            mandate_request: { links: { mandate: 'MD111' } },
          },
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const result = await resolveFulfilledBillingRequestMandate('BRQ999', {
        GOCARDLESS_ACCESS_TOKEN: 'test-token',
      })
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.mandateId, 'MD111')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fails when mandate is not ready after authorisation', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/billing_requests/BRQ000')) {
        return new Response(JSON.stringify({
          billing_requests: { id: 'BRQ000', status: 'pending', mandate_request: { links: {} } },
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const result = await resolveFulfilledBillingRequestMandate('BRQ000', {
        GOCARDLESS_ACCESS_TOKEN: 'test-token',
      })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.reason, 'mandate_not_ready')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
