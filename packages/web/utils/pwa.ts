/** True when running as an installed Home Screen / standalone PWA. */
export function isInstalledPwa(): boolean {
  if (import.meta.server) return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

const DEVICE_TOKEN_KEY = 'vmp_pwa_device_token'

/** Stable per-browser id for anonymous PWA push-login attempts. */
export function getOrCreatePwaDeviceToken(): string {
  if (import.meta.server) return ''
  try {
    const existing = localStorage.getItem(DEVICE_TOKEN_KEY)
    if (existing && existing.length > 0) return existing
    const token = crypto.randomUUID()
    localStorage.setItem(DEVICE_TOKEN_KEY, token)
    return token
  } catch {
    return crypto.randomUUID()
  }
}
