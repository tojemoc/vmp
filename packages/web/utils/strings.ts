/**
 * Locale-aware UI copy for the active deployment.
 *
 * Set `NUXT_PUBLIC_UI_LOCALE` (`en`, `sk`, or `cs`) at build time — one language
 * per VMP instance. Catalogs live in `locales/`; see `docs/i18n-prep.md`.
 *
 * Prefer `useStrings()` in new code; this default export keeps existing imports working.
 */
import { getBuildLocaleCatalog } from '~/utils/resolveUiLocale'

export type { PaymentProvider, PlanType, Strings } from '~/locales'

export default getBuildLocaleCatalog().strings
