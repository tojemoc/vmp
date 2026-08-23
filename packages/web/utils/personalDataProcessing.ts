/**
 * Locale-aware GDPR transparency copy (legacy catalog).
 * The public `/personal-data` page body is served from CMS (`cms-page-personal-data`);
 * prefer that for page content. Banner/contact strings live under `strings.*`.
 */
import { getActiveLocaleCatalog, getBuildLocaleCatalog } from '~/utils/resolveUiLocale';

export type { PersonalDataSection, PersonalDataStorageRow } from '~/locales';

export function getPersonalDataPage() {
  return import.meta.dev
    ? getActiveLocaleCatalog().personalData
    : getBuildLocaleCatalog().personalData;
}

/** @deprecated Prefer CMS `/personal-data` or `useStrings().personalData` in dev. */
export const personalDataPage = getPersonalDataPage();
