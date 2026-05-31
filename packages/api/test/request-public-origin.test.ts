import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNodeIncomingRequestUrl,
  getRequestPublicOrigin,
  isLocalVideoProxyUrl,
} from '../src/requestPublicOrigin.js'
import { buildProxyPlaylistUrl } from '../src/mediaEntrypoints.js'

describe('getRequestPublicOrigin', () => {
  it('prefers API_PUBLIC_URL over request.url', () => {
    const request = new Request('http://internal:8787/api/video-access/u/v', {
      headers: { host: 'internal:8787' },
    })
    const origin = getRequestPublicOrigin(request, { API_PUBLIC_URL: 'https://vmp-backup-api.tjm.sk' })
    assert.equal(origin, 'https://vmp-backup-api.tjm.sk')
  })

  it('uses X-Forwarded-Proto and Host when set', () => {
    const request = new Request('http://127.0.0.1/api/foo', {
      headers: {
        host: '127.0.0.1',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'vmp-backup-api.tjm.sk',
      },
    })
    assert.equal(getRequestPublicOrigin(request), 'https://vmp-backup-api.tjm.sk')
  })
})

describe('buildNodeIncomingRequestUrl', () => {
  it('builds https URL from forwarded headers', () => {
    const url = buildNodeIncomingRequestUrl(
      {
        url: '/api/video-access/anonymous/vid',
        headers: {
          host: '127.0.0.1:8787',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'vmp-backup-api.tjm.sk',
        },
      },
      { defaultPort: 8787 },
    )
    assert.equal(url, 'https://vmp-backup-api.tjm.sk/api/video-access/anonymous/vid')
  })

  it('uses API_PUBLIC_URL scheme when forwarded proto is missing', () => {
    const url = buildNodeIncomingRequestUrl(
      { url: '/api/health', headers: { host: 'localhost:8787' } },
      { env: { API_PUBLIC_URL: 'https://vmp-backup-api.tjm.sk' } },
    )
    assert.equal(url, 'https://localhost:8787/api/health')
  })
})

describe('buildProxyPlaylistUrl', () => {
  it('emits https video-proxy when request is http behind TLS proxy', () => {
    const request = new Request('http://127.0.0.1/api/video-access/u/v', {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'vmp-backup-api.tjm.sk',
      },
    })
    const proxy = buildProxyPlaylistUrl(
      request,
      'https://cdn.example.com/videos/vid/master.m3u8',
      120,
    )
    assert.equal(
      proxy,
      'https://vmp-backup-api.tjm.sk/api/video-proxy/videos/vid/master.m3u8?previewUntil=120',
    )
  })
})

describe('isLocalVideoProxyUrl', () => {
  it('matches proxy URLs on public or internal origin', () => {
    const request = new Request('http://127.0.0.1/api/foo', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.example.com' },
    })
    const httpsProxy = 'https://api.example.com/api/video-proxy/videos/x/master.m3u8'
    const httpProxy = 'http://127.0.0.1/api/video-proxy/videos/x/master.m3u8'
    assert.equal(isLocalVideoProxyUrl(request, httpsProxy), true)
    assert.equal(isLocalVideoProxyUrl(request, httpProxy), true)
    assert.equal(isLocalVideoProxyUrl(request, 'https://other.example/'), false)
  })
})
