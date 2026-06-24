/**
 * Long-lived HMAC tokens for /api/downloads/:videoId/assets/* (separate from
 * short-lived streaming vt tokens on /api/video-proxy).
 *
 * Payload: base64url("<userId>:<licenseId>:<deviceId>:<unixExpires>")
 */

function b64urlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function b64urlDecode(b64url: string): string {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/')
    + '=='.slice(0, (4 - (b64url.length % 4)) % 4)
  return atob(padded)
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export interface SignDownloadTokenOptions {
  ttlSeconds?: number
}

export async function signDownloadToken(
  userId: string,
  licenseId: string,
  deviceId: string,
  secret: string,
  opts: SignDownloadTokenOptions = {},
) {
  const ttlSeconds = Number.isFinite(opts.ttlSeconds)
    ? Math.max(60, Math.floor(opts.ttlSeconds as number))
    : 60 * 60 * 24 * 7
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = b64urlEncode(`${userId}:${licenseId}:${deviceId}:${expires}`)
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const sigHex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
  return `${payload}.${sigHex}`
}

export interface DownloadTokenClaims {
  userId: string
  licenseId: string
  deviceId: string
  expires: number
}

export async function verifyDownloadToken(token: string, secret: string): Promise<DownloadTokenClaims> {
  if (!token || typeof token !== 'string') throw new Error('Missing download token')
  const dotIndex = token.lastIndexOf('.')
  if (dotIndex < 1) throw new Error('Malformed download token')

  const payload = token.slice(0, dotIndex)
  const sigHex = token.slice(dotIndex + 1)
  if (!sigHex || sigHex.length === 0 || sigHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(sigHex)) {
    throw new Error('Malformed download token signature')
  }

  const key = await importHmacKey(secret)
  const sigBytes = new Uint8Array(sigHex.match(/../g)!.map(h => parseInt(h, 16)))
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
  if (!valid) throw new Error('Invalid download token signature')

  const decoded = b64urlDecode(payload)
  const parts = decoded.split(':')
  if (parts.length !== 4) throw new Error('Malformed download token payload')

  const [userId, licenseId, deviceId, expiresRaw] = parts
  if (!userId || !licenseId || !deviceId || !expiresRaw) {
    throw new Error('Malformed download token payload')
  }
  const expires = parseInt(expiresRaw, 10)
  if (!Number.isFinite(expires)) throw new Error('Malformed download token payload')
  if (Math.floor(Date.now() / 1000) > expires) throw new Error('Download token expired')

  return { userId, licenseId, deviceId, expires }
}
