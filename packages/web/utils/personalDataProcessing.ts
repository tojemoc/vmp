/**
 * Locale-aware GDPR transparency copy for `/personal-data`.
 */
import { getActiveLocaleCatalog, getBuildLocaleCatalog } from '~/utils/resolveUiLocale'

export type { PersonalDataSection, PersonalDataStorageRow } from '~/locales'

export function getPersonalDataPage() {
  return import.meta.dev
    ? getActiveLocaleCatalog().personalData
    : getBuildLocaleCatalog().personalData
}

/** @deprecated Prefer `useStrings().personalData` or `getPersonalDataPage()` in dev. */
export const personalDataPage = getPersonalDataPage()
