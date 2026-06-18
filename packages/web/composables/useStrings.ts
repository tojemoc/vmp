import { getLocaleCatalog, parseUiLocale } from '~/locales'
import { getActiveUiLocale } from '~/utils/resolveUiLocale'

/**
 * Active UI locale for this deployment (`runtimeConfig.public.uiLocale`),
 * with an optional dev-only cookie override for in-context translation review.
 */
export function useUiLocale() {
  const config = useRuntimeConfig()
  const locale = computed(() => getActiveUiLocale())
  const catalog = computed(() => getLocaleCatalog(locale.value))
  const buildLocale = computed(() => parseUiLocale(config.public.uiLocale as string))

  return {
    locale,
    htmlLang: computed(() => catalog.value.htmlLang),
    catalog,
    isDevLocalePreview: computed(
      () => import.meta.dev && locale.value !== buildLocale.value,
    ),
  }
}

/**
 * Reactive access to the locale catalog (strings + personal-data copy).
 */
export function useStrings() {
  const { locale, htmlLang, catalog, isDevLocalePreview } = useUiLocale()

  return {
    locale,
    htmlLang,
    isDevLocalePreview,
    strings: computed(() => catalog.value.strings),
    personalData: computed(() => catalog.value.personalData),
  }
}
