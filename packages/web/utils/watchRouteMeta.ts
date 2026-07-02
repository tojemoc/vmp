export type WatchRouteVideoMeta = {
  id: string
  slug?: string | null
}

/** True when route param is this video's vanity slug or canonical id. */
export function routeParamMatchesVideoMeta(
  routeParam: string,
  meta: WatchRouteVideoMeta,
): boolean {
  const param = decodeURIComponent(String(routeParam ?? '').trim())
  if (!param) return false
  const slug = typeof meta.slug === 'string' ? meta.slug.trim() : ''
  if (slug && param === slug) return true
  return param === meta.id
}
