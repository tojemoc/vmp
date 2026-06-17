import { getLocaleCatalog, parseUiLocale } from '~/locales'

/**
 * Active UI locale for this deployment (`runtimeConfig.public.uiLocale`).
 * One language per VMP instance — not an in-app language switcher.
 */
export function useUiLocale() {
  const config = useRuntimeConfig()
  const locale = computed(() => parseUiLocale(config.public.uiLocale as string))
  const catalog = computed(() => getLocaleCatalog(locale.value))

  return {
    locale,
    htmlLang: computed(() => catalog.value.htmlLang),
    catalog,
  }
}

/**
 * Reactive access to the locale catalog (strings + personal-data copy).
 */
export function useStrings() {
  const { locale, htmlLang, catalog } = useUiLocale()

  return {
    locale,
    htmlLang,
    strings: computed(() => catalog.value.strings),
    personalData: computed(() => catalog.value.personalData),
  }
}
