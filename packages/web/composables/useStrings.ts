import { getLocaleCatalog, parseUiLocale } from '~/locales'
import { DEV_UI_LOCALE_COOKIE } from '~/utils/resolveUiLocale'

/**
 * Active UI locale for this deployment (`runtimeConfig.public.uiLocale`),
 * with an optional dev-only cookie override for in-context translation review.
 */
export function useUiLocale() {
  const config = useRuntimeConfig()
  const locale = computed(() => {
    if (import.meta.dev) {
      try {
        const cookie = useCookie(DEV_UI_LOCALE_COOKIE)
        if (cookie.value) return parseUiLocale(cookie.value)
      } catch {
        // ignore
      }
    }
    return parseUiLocale(config.public.uiLocale as string)
  })
  const catalog = computed(() => getLocaleCatalog(locale.value))

  return {
    locale,
    htmlLang: computed(() => catalog.value.htmlLang),
    catalog,
    isDevLocalePreview: computed(
      () => import.meta.dev && locale.value !== parseUiLocale(config.public.uiLocale as string),
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
