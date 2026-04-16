/**
 * Singleton composable that fetches public site branding settings once and
 * provides them reactively to the header, page title, and anywhere else.
 */

import strings from '~/utils/strings'

interface SiteSettings {
  siteName: string
  siteNameShort: string
  siteDescription: string
  logoUrl: string
  faviconUrl: string
}

const siteSettings = ref<SiteSettings>({
  siteName: strings.siteName,
  siteNameShort: strings.siteNameShort,
  siteDescription: strings.siteDescription,
  logoUrl: '',
  faviconUrl: '',
})

let fetched = false

export function useSiteSettings() {
  const config = useRuntimeConfig()

  async function fetchSiteSettings() {
    if (fetched) return
    fetched = true
    try {
      const res = await fetch(`${config.public.apiUrl}/api/site-settings`)
      if (!res.ok) return
      const data = await res.json()
      siteSettings.value = {
        siteName: data.site_name || strings.siteName,
        siteNameShort: data.site_name_short || strings.siteNameShort,
        siteDescription: data.site_description || strings.siteDescription,
        logoUrl: data.site_logo_url || '',
        faviconUrl: data.site_favicon_url || '',
      }
    } catch {
      // Best-effort; fallback to static strings
    }
  }

  return {
    siteSettings: readonly(siteSettings),
    fetchSiteSettings,
  }
}
