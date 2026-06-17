import { DEV_UI_LOCALE_COOKIE } from '~/utils/resolveUiLocale'
import type { UiLocale } from '~/locales'

/** Dev only: `?uiLocale=sk` seeds the preview cookie, then redirects without the query param. */
export default defineNuxtRouteMiddleware((to) => {
  if (!import.meta.dev) return

  const raw = to.query.uiLocale
  if (typeof raw !== 'string') return

  const locale = raw.toLowerCase()
  if (locale !== 'en' && locale !== 'sk' && locale !== 'cs') return

  const cookie = useCookie(DEV_UI_LOCALE_COOKIE, { maxAge: 60 * 60 * 24 * 30 })
  cookie.value = locale

  const query = { ...to.query }
  delete query.uiLocale
  return navigateTo({ path: to.path, query, hash: to.hash }, { replace: true })
})
