import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStripeStatus, stripeSubscriptionPeriodEndIso, stripeSubscriptionPeriodEndUnix } from '../src/stripeClient.js'

describe('stripeSubscriptionPeriodEndUnix', () => {
  it('prefers top-level current_period_end', () => {
    assert.equal(stripeSubscriptionPeriodEndUnix({ current_period_end: 1_700_000_000 }), 1_700_000_000)
  })

  it('falls back to first item current_period_end', () => {
    assert.equal(
      stripeSubscriptionPeriodEndUnix({
        current_period_end: null,
        items: { data: [{ current_period_end: 1_800_000_000 }] },
      }),
      1_800_000_000,
    )
  })

  it('returns null when no period end is present', () => {
    assert.equal(stripeSubscriptionPeriodEndUnix({ items: { data: [{}] } }), null)
  })
})

describe('stripeSubscriptionPeriodEndIso', () => {
  it('converts Unix seconds to ISO-8601', () => {
    assert.equal(
      stripeSubscriptionPeriodEndIso({ current_period_end: 1_700_000_000 }),
      new Date(1_700_000_000 * 1000).toISOString(),
    )
  })
})

describe('normalizeStripeStatus', () => {
  it('maps active lifecycle statuses', () => {
    assert.equal(normalizeStripeStatus('active'), 'active')
    assert.equal(normalizeStripeStatus('trialing'), 'trialing')
    assert.equal(normalizeStripeStatus('past_due'), 'past_due')
  })

  it('maps terminal statuses to cancelled', () => {
    assert.equal(normalizeStripeStatus('canceled'), 'cancelled')
    assert.equal(normalizeStripeStatus('cancelled'), 'cancelled')
    assert.equal(normalizeStripeStatus('incomplete_expired'), 'cancelled')
    assert.equal(normalizeStripeStatus('paused'), 'cancelled')
  })

  it('maps recoverable failures to past_due', () => {
    assert.equal(normalizeStripeStatus('unpaid'), 'past_due')
    assert.equal(normalizeStripeStatus('incomplete'), 'past_due')
  })

  it('falls back unknown or non-normalized values to cancelled', () => {
    assert.equal(normalizeStripeStatus('ACTIVE'), 'cancelled')
    assert.equal(normalizeStripeStatus('unexpected_state'), 'cancelled')
  })
})
