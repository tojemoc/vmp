/**
 * Loads GTM container from public site settings when configured in admin.
 */
import { getGtmScriptUrl } from '~/utils/gtm'

export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig()
  const { siteSettings, fetchSiteSettings } = useSiteSettings()

  function loadGtm(containerId: string, measurementPath?: string | null) {
    const id = containerId.trim()
    if (!id || typeof window === 'undefined') return
    if ((window as any).google_tag_manager?.[id]) return

    ;(window as any).dataLayer = (window as any).dataLayer || []
    ;(window as any).dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    const script = document.createElement('script')
    script.async = true
    script.src = getGtmScriptUrl(id, measurementPath)
    document.head.appendChild(script)
  }

  await fetchSiteSettings()
  const fromSettings = String(siteSettings.value.gtmContainerId ?? '').trim()
  const measurementPath = String(siteSettings.value.gtmMeasurementPath ?? '').trim() || null
  const fallback = String(config.public.gtm?.id ?? '').trim()
  const effectiveId = fromSettings || fallback
  loadGtm(effectiveId, effectiveId ? measurementPath : null)
})
