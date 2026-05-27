/**
 * Block push endpoint hostnames that resolve to loopback, link-local, or RFC-private space.
 */

function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 127) return true // 127.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 192 && b === 0) return true // 192.0.0.0/24
  void d
  return false
}

function parseIpv4Octets(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  if (o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return o as [number, number, number, number]
}

/** Strip brackets and zone id; lowercase. */
function normalizeHost(hostname: string): string {
  let h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  const zone = h.indexOf('%')
  if (zone >= 0) h = h.slice(0, zone)
  const v4WithPort = h.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (v4WithPort?.[1]) h = v4WithPort[1]
  return h
}

export function isPrivateHost(hostname: string): boolean {
  if (!hostname) return true
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return true
  }

  const h = normalizeHost(hostname)

  const ipv4 = parseIpv4Octets(h)
  if (ipv4) return isPrivateIPv4(...ipv4)

  // Domain names must not contain ':' (IPv6 always does).
  if (!h.includes(':')) return false

  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true // unspecified
  if (h === '::1') return true // loopback

  if (h.startsWith('fe80:')) return true // link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd')) return true // ULA fc00::/7
  if (h.startsWith('ff')) return true // multicast ff00::/8

  const mappedDotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mappedDotted?.[1]) {
    const inner = parseIpv4Octets(mappedDotted[1])
    if (!inner) return true
    return isPrivateIPv4(...inner)
  }

  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex?.[1] && mappedHex?.[2]) {
    const a = parseInt(mappedHex[1], 16)
    const b = parseInt(mappedHex[2], 16)
    return isPrivateIPv4(a >> 8, a & 0xff, b >> 8, b & 0xff)
  }

  return false
}
