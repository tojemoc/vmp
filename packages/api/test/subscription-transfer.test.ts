import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEmail } from '../src/subscriptionTransfer.js'

describe('subscription transfer email normalization', () => {
  it('lowercases and trims valid emails', () => {
    assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com')
  })

  it('rejects blank or invalid addresses', () => {
    assert.equal(normalizeEmail(''), null)
    assert.equal(normalizeEmail('not-an-email'), null)
  })
})
