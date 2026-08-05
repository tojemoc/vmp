import { cs } from './cs';
import { en } from './en';
import { sk } from './sk';
import type { LocaleCatalog, UiLocale } from './types';

export type {
  LocaleCatalog,
  PaymentProvider,
  PersonalDataPage,
  PersonalDataSection,
  PersonalDataStorageRow,
  PlanType,
  Strings,
  StringsDefinition,
  UiLocale,
} from './types';

const catalogs: Record<UiLocale, LocaleCatalog> = {
  en,
  sk,
  cs,
};

export const SUPPORTED_UI_LOCALES = ['en', 'sk', 'cs'] as const satisfies readonly UiLocale[];

export function parseUiLocale(raw: string | undefined): UiLocale {
  const value = (raw || 'en').toLowerCase();
  if (value === 'sk' || value === 'cs') return value;
  return 'en';
}

export function getLocaleCatalog(locale: UiLocale): LocaleCatalog {
  return catalogs[locale] ?? catalogs.en;
}
