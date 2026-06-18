/**
 * Locale-aware UI copy for the active deployment.
 *
 * Production: `NUXT_PUBLIC_UI_LOCALE` at build time (one language per instance).
 * Development: optional cookie override via the locale preview bar for in-context review.
 */
import type { Strings } from '~/locales'
import { getActiveLocaleCatalog, getBuildLocaleCatalog } from '~/utils/resolveUiLocale'

export type { PaymentProvider, PlanType, Strings } from '~/locales'

function createDevStringsProxy(): Strings {
  return new Proxy({} as Strings, {
    get(_target, prop) {
      const value = getActiveLocaleCatalog().strings[prop as keyof Strings]
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(getActiveLocaleCatalog().strings)
      }
      return value
    },
  })
}

export default import.meta.dev ? createDevStringsProxy() : getBuildLocaleCatalog().strings
