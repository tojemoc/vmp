import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isLicensePlaybackAllowed, isLicenseRevalidationDue } from '../utils/offline/licenseClient'
import type { OfflineLicense } from '@vmp/shared'

function sampleLicense(overrides: Partial<OfflineLicense> = {}): OfflineLicense {
  return {
    licenseId: 'lic-1',
    deviceId: 'dev-1',
    videoId: 'vid-1',
    rendition: '720p',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    manifestHash: 'abc',
    manifestVersion: 1,
    playbackState: 'allowed',
    nextValidationDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    signature: 'sig',
    ...overrides,
  }
}

describe('offline licenseClient', () => {
  it('allows playback for active unexpired licenses', () => {
    assert.equal(isLicensePlaybackAllowed(sampleLicense()), true)
  })

  it('blocks revoked or expired licenses', () => {
    assert.equal(isLicensePlaybackAllowed(sampleLicense({ playbackState: 'revoked' })), false)
    assert.equal(
      isLicensePlaybackAllowed(sampleLicense({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
      false,
    )
  })

  it('detects revalidation due dates', () => {
    assert.equal(
      isLicenseRevalidationDue(sampleLicense({ nextValidationDueAt: new Date(Date.now() - 1000).toISOString() })),
      true,
    )
    assert.equal(
      isLicenseRevalidationDue(sampleLicense({ nextValidationDueAt: new Date(Date.now() + 86_400_000).toISOString() })),
      false,
    )
  })
})
