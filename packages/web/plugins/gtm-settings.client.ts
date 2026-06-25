/**
 * Loads GTM from public site settings when enabled in Admin → System.
 * Container ID and optional Cloudflare Google Tag Gateway path are runtime-only (D1).
 */
import { getGtmScriptUrl } from '~/utils/gtm'

export default defineNuxtPlugin(async () => {
  const router = useRouter()
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

  function installRouterSync() {
    router.afterEach((to) => {
      const w = window as Window & { dataLayer?: Array<Record<string, unknown>> }
      w.dataLayer = w.dataLayer ?? []
      const base = router.options.history?.base ?? ''
      const suffix = to.fullPath.startsWith('/') ? to.fullPath : `/${to.fullPath}`
      const path = `${base}${suffix}`.replace(/\/{2,}/g, '/')
      const viewName = typeof to.name === 'string' && to.name ? to.name : path
      w.dataLayer.push({
        event: 'content-view',
        'content-name': path,
        'content-view-name': viewName,
      })
    })
  }

  await fetchSiteSettings()
  if (!siteSettings.value.gtmEnabled) return

  const containerId = String(siteSettings.value.gtmContainerId ?? '').trim()
  if (!containerId) return

  const measurementPath = String(siteSettings.value.gtmMeasurementPath ?? '').trim() || null
  loadGtm(containerId, measurementPath)
  installRouterSync()
})
