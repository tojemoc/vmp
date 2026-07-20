import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDashboardAuthConfigured,
  isExternallyAuthenticatedPath,
  isLoopbackHost,
  requiresDashboardAuth,
  resolvePackagerCallbackJobId,
  verifyDashboardSecret,
  verifyPackagerCallbackSecret,
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
    assert.equal(requiresDashboardAuth('/', 'GET'), false)
    assert.equal(requiresDashboardAuth('/api/podcast-preview-rebuild', 'POST'), false)
    assert.equal(requiresDashboardAuth('/api/status', 'GET'), true)
    assert.equal(requiresDashboardAuth('/api/jobs/foo/stop', 'POST'), true)
  })

  it('reports whether dashboard auth is configured', () => {
    assert.equal(isDashboardAuthConfigured(''), false)
    assert.equal(isDashboardAuthConfigured('  secret  '), true)
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

  it('verifies packager callbacks via Basic auth or x-vmp-pipeline-secret', () => {
    const secret = 'packager-secret'
    const basic = Buffer.from(`vmp:${secret}`).toString('base64')
    const basicReq = {
      headers: { authorization: `Basic ${basic}` },
    } as unknown as import('node:http').IncomingMessage
    const headerReq = {
      headers: { 'x-vmp-pipeline-secret': secret },
    } as unknown as import('node:http').IncomingMessage
    const badReq = {
      headers: { authorization: `Basic ${Buffer.from('vmp:wrong').toString('base64')}` },
    } as unknown as import('node:http').IncomingMessage
    assert.equal(verifyPackagerCallbackSecret(basicReq, secret), true)
    assert.equal(verifyPackagerCallbackSecret(headerReq, secret), true)
    assert.equal(verifyPackagerCallbackSecret(badReq, secret), false)
    assert.equal(verifyPackagerCallbackSecret(basicReq, ''), true)
  })

  it('resolves packager jobId from Eyevinn failure message payload', () => {
    assert.equal(resolvePackagerCallbackJobId({ jobId: 'abc' }), 'abc')
    assert.equal(
      resolvePackagerCallbackJobId({
        message: JSON.stringify({ jobId: 'from-redis', url: 'http://encore-web:8080/encoreJobs/x' }),
      }),
      'from-redis',
    )
    assert.equal(resolvePackagerCallbackJobId({ message: 'not-json' }), '')
  })
})
