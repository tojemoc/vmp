import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAvailabilityError } from '../src/errors.js'

describe('isAvailabilityError', () => {
  it('treats AWS SDK TimeoutError as availability error', () => {
    const err = new Error('Timeout') as Error & { name: string }
    err.name = 'TimeoutError'
    assert.equal(isAvailabilityError(err), true)
  })

  it('treats "timed out" message as availability error', () => {
    assert.equal(isAvailabilityError(new Error('Request timed out')), true)
  })

  it('does not treat NoSuchKey as availability error', () => {
    const err = new Error('Not found') as Error & { name: string }
    err.name = 'NoSuchKey'
    assert.equal(isAvailabilityError(err), false)
  })
})
