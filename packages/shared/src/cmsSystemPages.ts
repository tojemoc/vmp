/** Fixed CMS page id for site-wide footer content (not a public route). */
export const CMS_FOOTER_PAGE_ID = 'f0000001-0000-4000-8000-000000000001'

/** Internal slug — reserved; footer content is rendered in AppFooter, not at this URL. */
export const CMS_FOOTER_SLUG = '_footer'

export const CMS_PERSONAL_DATA_PAGE_ID = 'cms-page-personal-data'

const CMS_SYSTEM_PAGE_IDS = new Set([
  CMS_FOOTER_PAGE_ID,
  CMS_PERSONAL_DATA_PAGE_ID,
])

export function isCmsSystemPageId(id: string): boolean {
  return CMS_SYSTEM_PAGE_IDS.has(id)
}

export function isCmsSystemSlug(slug: string): boolean {
  return slug === CMS_FOOTER_SLUG
}
