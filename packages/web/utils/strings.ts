/**
 * Locale-aware UI copy for the active deployment.
 *
 * Production: `NUXT_PUBLIC_UI_LOCALE` at build time (one language per instance).
 * Development: optional cookie override via the locale preview bar for in-context review.
 */
import type { Strings } from '~/locales'
import { getActiveLocaleCatalog } from '~/utils/resolveUiLocale'

export type { PaymentProvider, PlanType, Strings } from '~/locales'

function createStringsProxy(): Strings {
  return new Proxy({} as Strings, {
    get(_target, prop) {
      const catalog = getActiveLocaleCatalog()
      const value = catalog.strings[prop as keyof Strings]
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(catalog.strings)
      }
      return value
    },
  })
}

/** Resolves against the active locale on each access (build default or dev cookie override). */
export default createStringsProxy()
