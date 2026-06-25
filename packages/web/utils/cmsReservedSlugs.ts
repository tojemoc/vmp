/**
 * Slugs that have dedicated Nuxt routes and must not be served by the CMS catch-all.
 */
export const CMS_RESERVED_SLUGS = new Set([
  'admin',
  'login',
  'account',
  'auth',
  'watch',
  'videos',
  'category',
  '_footer',
])

export function isCmsReservedSlug(slug: string): boolean {
  if (!slug) return true
  if (CMS_RESERVED_SLUGS.has(slug)) return true
  return CMS_RESERVED_SLUGS.has(slug.split('/')[0] ?? '')
}
