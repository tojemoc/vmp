import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsvUserRows } from '../src/userImportCsv.js'

describe('parseCsvUserRows', () => {
  it('parses unstructured email-only CSV', () => {
    const rows = parseCsvUserRows('user@example.com\nsecond@example.com')
    assert.deepEqual(rows, [
      { email: 'user@example.com', purchaseId: null },
      { email: 'second@example.com', purchaseId: null },
    ])
  })

  it('parses headered CSV with purchaseId column', () => {
    const rows = parseCsvUserRows(`email,purchaseId
User@Example.com,client-123
second@example.com,client-456`)
    assert.deepEqual(rows, [
      { email: 'user@example.com', purchaseId: 'client-123' },
      { email: 'second@example.com', purchaseId: 'client-456' },
    ])
  })

  it('accepts clientId as purchase id header alias', () => {
    const rows = parseCsvUserRows(`email,clientId
user@example.com,abc`)
    assert.deepEqual(rows, [{ email: 'user@example.com', purchaseId: 'abc' }])
  })

  it('parses two-column CSV without header row', () => {
    const rows = parseCsvUserRows('user@example.com,legacy-99')
    assert.deepEqual(rows, [{ email: 'user@example.com', purchaseId: 'legacy-99' }])
  })

  it('deduplicates repeated emails', () => {
    const rows = parseCsvUserRows(`email,purchaseId
user@example.com,one
user@example.com,two`)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].email, 'user@example.com')
    assert.equal(rows[0].purchaseId, 'one')
  })
})
