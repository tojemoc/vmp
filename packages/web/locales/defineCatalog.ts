import type { LocaleCatalog, PersonalDataPage, Strings, StringsDefinition, UiLocale } from './types'

type StringMaps = {
  planNames: Record<string, string>
  roleLabels: Record<string, string>
}

export function defineCatalog(
  locale: UiLocale,
  htmlLang: string,
  stringsDef: StringsDefinition,
  maps: StringMaps,
  personalData: PersonalDataPage,
): LocaleCatalog {
  const strings: Strings = {
    ...stringsDef,
    planDisplayName(planType: string) {
      return maps.planNames[planType] ?? planType
    },
    paymentProviderLabel(provider: string) {
      if (provider === 'stripe') return 'Stripe'
      if (provider === 'legacy') return 'Legacy'
      return provider
    },
    roleLabel(role: string | undefined) {
      return maps.roleLabels[role ?? ''] ?? maps.roleLabels.viewer ?? 'Viewer'
    },
  }

  return { locale, htmlLang, strings, personalData }
}
