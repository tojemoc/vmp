/**
 * Locale-aware GDPR transparency copy for `/personal-data`.
 * Resolved from `NUXT_PUBLIC_UI_LOCALE` at build time (see `locales/`).
 */
import { getBuildLocaleCatalog } from '~/utils/resolveUiLocale'

export type { PersonalDataSection, PersonalDataStorageRow } from '~/locales'

export const personalDataPage = getBuildLocaleCatalog().personalData
