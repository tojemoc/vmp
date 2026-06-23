import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { signDownloadToken, verifyDownloadToken } from '../src/downloadTokens.js'

const SECRET = 'test-secret-at-least-thirty-two-characters-long'

describe('downloadTokens', () => {
  it('signs and verifies a download token', async () => {
    const token = await signDownloadToken('user-1', 'license-1', 'device-1', SECRET, { ttlSeconds: 3600 })
    const claims = await verifyDownloadToken(token, SECRET)
    assert.equal(claims.userId, 'user-1')
    assert.equal(claims.licenseId, 'license-1')
    assert.equal(claims.deviceId, 'device-1')
    assert.ok(claims.expires > Math.floor(Date.now() / 1000))
  })

  it('rejects tokens signed with a different secret', async () => {
    const token = await signDownloadToken('user-1', 'license-1', 'device-1', SECRET)
    await assert.rejects(
      () => verifyDownloadToken(token, 'other-secret-at-least-thirty-two-characters'),
      /Invalid download token signature/,
    )
  })

  it('rejects expired tokens', async () => {
    const token = await signDownloadToken('user-1', 'license-1', 'device-1', SECRET, { ttlSeconds: 60 })
    const parts = token.split('.')
    const payload = parts[0]
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const segments = decoded.split(':')
    segments[3] = String(Math.floor(Date.now() / 1000) - 10)
    const expiredPayload = Buffer.from(segments.join(':')).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const expiredToken = `${expiredPayload}.${parts[1]}`
    await assert.rejects(
      () => verifyDownloadToken(expiredToken, SECRET),
      /Invalid download token signature|Download token expired/,
    )
  })
})
