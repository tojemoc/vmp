import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isExternallyAuthenticatedPath,
  isLoopbackHost,
  requiresDashboardAuth,
  verifyDashboardSecret,
} from '../supervisorAuth.js'

describe('supervisorAuth', () => {
  it('classifies loopback hosts', () => {
    assert.equal(isLoopbackHost('127.0.0.1'), true)
    assert.equal(isLoopbackHost('::1'), true)
    assert.equal(isLoopbackHost('0.0.0.0'), false)
  })

  it('allows webhook and packaging paths without dashboard auth', () => {
    assert.equal(isExternallyAuthenticatedPath('/api/podcast-preview-rebuild', 'POST'), true)
    assert.equal(isExternallyAuthenticatedPath('/api/packaging/enqueue', 'POST'), true)
    assert.equal(isExternallyAuthenticatedPath('/vmp/api/packagerCallback/success', 'POST'), true)
    assert.equal(requiresDashboardAuth('/api/podcast-preview-rebuild', 'POST'), false)
    assert.equal(requiresDashboardAuth('/api/status', 'GET'), true)
    assert.equal(requiresDashboardAuth('/api/jobs/foo/stop', 'POST'), true)
  })

  it('verifies dashboard bearer token with timing-safe compare', () => {
    const secret = 'test-dashboard-secret'
    const okReq = {
      headers: { authorization: 'Bearer test-dashboard-secret' },
    } as import('node:http').IncomingMessage
    const badReq = {
      headers: { authorization: 'Bearer wrong' },
    } as import('node:http').IncomingMessage
    assert.equal(verifyDashboardSecret(okReq, secret), true)
    assert.equal(verifyDashboardSecret(badReq, secret), false)
    assert.equal(verifyDashboardSecret(okReq, ''), true)
  })
})
