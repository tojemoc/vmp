/**
 * Build GTM script / noscript URLs for first-party gateway or direct Google load.
 */
export function getGtmScriptUrl(containerId: string, measurementPath?: string | null): string {
  const id = containerId.trim()
  if (!id) return ''
  const path = measurementPath?.trim().replace(/\/$/, '')
  if (path) {
    return `${path}/gtm.js?id=${id}`
  }
  return `https://www.googletagmanager.com/gtm.js?id=${id}`
}

export function getGtmNoscriptUrl(containerId: string, measurementPath?: string | null): string {
  const id = containerId.trim()
  if (!id) return ''
  const path = measurementPath?.trim().replace(/\/$/, '')
  if (path) {
    return `${path}/ns.html?id=${id}`
  }
  return `https://www.googletagmanager.com/ns.html?id=${id}`
}
