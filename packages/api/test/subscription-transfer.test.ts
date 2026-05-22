import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Mirrors email normalization used in subscriptionTransfer.ts
 */
function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) return null
  return trimmed
}

describe('subscription transfer email normalization', () => {
  it('lowercases and trims valid emails', () => {
    assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com')
  })

  it('rejects blank or invalid addresses', () => {
    assert.equal(normalizeEmail(''), null)
    assert.equal(normalizeEmail('not-an-email'), null)
  })
})
