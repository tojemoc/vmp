import { getLocaleCatalog, parseUiLocale, type UiLocale } from '~/locales'

let cachedBuildLocale: UiLocale | null = null

/**
 * UI locale for this deployment. Set `NUXT_PUBLIC_UI_LOCALE` at build time
 * (`en`, `sk`, or `cs`) — one language per VMP instance, not an in-app switcher.
 */
export function getBuildUiLocale(): UiLocale {
  if (cachedBuildLocale) return cachedBuildLocale
  const fromEnv =
    (typeof import.meta !== 'undefined' && import.meta.env?.NUXT_PUBLIC_UI_LOCALE) ||
    (typeof process !== 'undefined' ? process.env.NUXT_PUBLIC_UI_LOCALE : undefined)
  cachedBuildLocale = parseUiLocale(typeof fromEnv === 'string' ? fromEnv : undefined)
  return cachedBuildLocale
}

export function getBuildLocaleCatalog() {
  return getLocaleCatalog(getBuildUiLocale())
}
