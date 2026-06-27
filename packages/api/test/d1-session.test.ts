import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../src/d1Session.js'

describe('getDb', () => {
  it('prefers env.DB when both bindings are present', () => {
    const primary = { prepare: () => ({}) }
    const replica = { prepare: () => ({}) }
    assert.equal(getDb({ DB: primary, video_subscription_db: replica }), primary)
  })

  it('falls back to video_subscription_db when env.DB is missing', () => {
    const db = { prepare: () => ({}) }
    assert.equal(getDb({ video_subscription_db: db }), db)
  })

  it('throws when no D1 binding is configured', () => {
    assert.throws(() => getDb({}), /D1 binding not found/)
  })
})
