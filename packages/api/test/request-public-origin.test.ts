import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNodeIncomingRequestUrl,
  getRequestPublicOrigin,
  isLocalVideoProxyUrl,
  normalizePublicOrigin,
  resolveExplicitPublicOrigin,
} from '../src/requestPublicOrigin.js'
import { buildProxyPlaylistUrl } from '../src/mediaEntrypoints.js'

describe('resolveExplicitPublicOrigin', () => {
  it('prefers API_PUBLIC_URL over API_URL', () => {
    assert.equal(
      resolveExplicitPublicOrigin({
        API_PUBLIC_URL: 'https://primary.example.com',
        API_URL: 'https://backup.example.com',
      }),
      'https://primary.example.com',
    )
  })

  it('falls back to API_URL', () => {
    assert.equal(
      resolveExplicitPublicOrigin({ API_URL: 'https://vmp-backup-api.tjm.sk' }),
      'https://vmp-backup-api.tjm.sk',
    )
  })
})

describe('normalizePublicOrigin', () => {
  it('upgrades http public hosts to https', () => {
    assert.equal(
      normalizePublicOrigin('http://vmp-backup-api.tjm.sk'),
      'https://vmp-backup-api.tjm.sk',
    )
  })

  it('keeps localhost on http for local dev', () => {
    assert.equal(normalizePublicOrigin('http://localhost:8787'), 'http://localhost:8787')
  })
})

describe('getRequestPublicOrigin', () => {
  it('prefers API_PUBLIC_URL over request.url', () => {
    const request = new Request('http://internal:8787/api/video-access/u/v', {
      headers: { host: 'internal:8787' },
    })
    const origin = getRequestPublicOrigin(request, { API_PUBLIC_URL: 'https://vmp-backup-api.tjm.sk' })
    assert.equal(origin, 'https://vmp-backup-api.tjm.sk')
  })

  it('uses API_URL when API_PUBLIC_URL is unset', () => {
    const request = new Request('http://127.0.0.1/api/foo', {
      headers: { host: '127.0.0.1' },
    })
    assert.equal(
      getRequestPublicOrigin(request, { API_URL: 'https://vmp-backup-api.tjm.sk' }),
      'https://vmp-backup-api.tjm.sk',
    )
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

  it('upgrades http public host without forwarded proto to https', () => {
    const request = new Request('http://vmp-backup-api.tjm.sk/api/video-access/u/v', {
      headers: { host: 'vmp-backup-api.tjm.sk' },
    })
    assert.equal(getRequestPublicOrigin(request), 'https://vmp-backup-api.tjm.sk')
  })

  it('upgrades misleading x-forwarded-proto http on public host', () => {
    const request = new Request('http://vmp-backup-api.tjm.sk/api/foo', {
      headers: {
        host: 'vmp-backup-api.tjm.sk',
        'x-forwarded-proto': 'http',
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

  it('uses API_PUBLIC_URL origin when forwarded proto is missing', () => {
    const url = buildNodeIncomingRequestUrl(
      { url: '/api/health', headers: { host: 'localhost:8787' } },
      { env: { API_PUBLIC_URL: 'https://vmp-backup-api.tjm.sk' } },
    )
    assert.equal(url, 'https://vmp-backup-api.tjm.sk/api/health')
  })

  it('uses API_URL origin when API_PUBLIC_URL is unset', () => {
    const url = buildNodeIncomingRequestUrl(
      { url: '/api/health', headers: { host: 'localhost:8787' } },
      { env: { API_URL: 'https://vmp-backup-api.tjm.sk' } },
    )
    assert.equal(url, 'https://vmp-backup-api.tjm.sk/api/health')
  })

  it('upgrades public host to https when no env or forwarded proto', () => {
    const url = buildNodeIncomingRequestUrl(
      { url: '/api/video-access/anonymous/vid', headers: { host: 'vmp-backup-api.tjm.sk' } },
      { defaultPort: 8787 },
    )
    assert.equal(url, 'https://vmp-backup-api.tjm.sk/api/video-access/anonymous/vid')
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

  it('emits https video-proxy for public host without forwarded headers', () => {
    const request = new Request('http://vmp-backup-api.tjm.sk/api/video-access/u/v', {
      headers: { host: 'vmp-backup-api.tjm.sk' },
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

  it('matches http proxy URL on public host after https normalization', () => {
    const request = new Request('http://vmp-backup-api.tjm.sk/api/foo', {
      headers: { host: 'vmp-backup-api.tjm.sk' },
    })
    const httpProxy = 'http://vmp-backup-api.tjm.sk/api/video-proxy/videos/x/master.m3u8'
    assert.equal(isLocalVideoProxyUrl(request, httpProxy), true)
  })
})
