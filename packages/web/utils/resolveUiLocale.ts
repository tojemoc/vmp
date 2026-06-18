import { getLocaleCatalog, parseUiLocale, type UiLocale } from '~/locales'

let cachedBuildLocale: UiLocale | null = null

/** Cookie / query key — dev only; never set in production deployments. */
export const DEV_UI_LOCALE_COOKIE = 'vmp_dev_ui_locale'

/**
 * UI locale baked into this build from `NUXT_PUBLIC_UI_LOCALE`.
 * Production instances use this exclusively.
 */
export function getBuildUiLocale(): UiLocale {
  if (cachedBuildLocale) return cachedBuildLocale
  const fromEnv =
    (typeof import.meta !== 'undefined' && import.meta.env?.NUXT_PUBLIC_UI_LOCALE) ||
    (typeof process !== 'undefined' ? process.env.NUXT_PUBLIC_UI_LOCALE : undefined)
  cachedBuildLocale = parseUiLocale(typeof fromEnv === 'string' ? fromEnv : undefined)
  return cachedBuildLocale
}

/**
 * Active locale: build default, or dev cookie override (for in-context translation review).
 * Call from composables / plugins — not at static module top-level.
 */
export function getActiveUiLocale(): UiLocale {
  if (import.meta.dev) {
    try {
      const cookie = useCookie(DEV_UI_LOCALE_COOKIE)
      if (cookie.value) return parseUiLocale(cookie.value)
    } catch {
      // Outside Nuxt setup (e.g. rare import timing) — fall through.
    }
  }
  return getBuildUiLocale()
}

export function getBuildLocaleCatalog() {
  return getLocaleCatalog(getBuildUiLocale())
}

export function getActiveLocaleCatalog() {
  return getLocaleCatalog(getActiveUiLocale())
}

/**
 * Dev-only: persist preview locale and reload so SSR + client both pick it up.
 */
export function setDevUiLocalePreview(locale: UiLocale) {
  if (!import.meta.dev || !import.meta.client) return
  const cookie = useCookie(DEV_UI_LOCALE_COOKIE, { maxAge: 60 * 60 * 24 * 30 })
  cookie.value = locale
  window.location.reload()
}

export function clearDevUiLocalePreview() {
  if (!import.meta.dev || !import.meta.client) return
  const cookie = useCookie(DEV_UI_LOCALE_COOKIE)
  cookie.value = null
  window.location.reload()
}
