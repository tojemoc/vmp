/** True when running as an installed Home Screen / standalone PWA. */
export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false

  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true
  const displayModeFullscreen = window.matchMedia?.('(display-mode: fullscreen)').matches === true

  console.log('[PWA DETECT]', {
    standalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
    displayStandalone: window.matchMedia?.('(display-mode: standalone)').matches,
    displayFullscreen: window.matchMedia?.('(display-mode: fullscreen)').matches,
    userAgent: window.navigator.userAgent,
  })

  return iosStandalone || displayModeStandalone || displayModeFullscreen
}

const DEVICE_TOKEN_KEY = 'vmp_pwa_device_token'
let fallbackDeviceToken: string | null = null

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
    if (!fallbackDeviceToken) fallbackDeviceToken = crypto.randomUUID()
    return fallbackDeviceToken
  }
}
