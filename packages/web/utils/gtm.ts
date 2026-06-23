/**
 * Build GTM script / noscript URLs for first-party gateway or direct Google load.
 */
function normalizeMeasurementPath(measurementPath?: string | null): string {
  const raw = measurementPath?.trim().replace(/\/$/, '')
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function getGtmScriptUrl(containerId: string, measurementPath?: string | null): string {
  const id = containerId.trim()
  if (!id) return ''
  const path = normalizeMeasurementPath(measurementPath)
  const encodedId = encodeURIComponent(id)
  if (path) {
    return `${path}/gtm.js?id=${encodedId}`
  }
  return `https://www.googletagmanager.com/gtm.js?id=${encodedId}`
}

export function getGtmNoscriptUrl(containerId: string, measurementPath?: string | null): string {
  const id = containerId.trim()
  if (!id) return ''
  const path = normalizeMeasurementPath(measurementPath)
  const encodedId = encodeURIComponent(id)
  if (path) {
    return `${path}/ns.html?id=${encodedId}`
  }
  return `https://www.googletagmanager.com/ns.html?id=${encodedId}`
}
