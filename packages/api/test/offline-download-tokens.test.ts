import { describe, it, mock } from 'node:test'
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
    const nowSpy = mock.method(Date, 'now', () => 1_700_000_000_000)
    try {
      const token = await signDownloadToken('user-1', 'license-1', 'device-1', SECRET, { ttlSeconds: 60 })
      nowSpy.mock.mockImplementation(() => 1_700_000_120_000)
      await assert.rejects(
        () => verifyDownloadToken(token, SECRET),
        /Download token expired/,
      )
    } finally {
      nowSpy.mock.restore()
    }
  })
})
