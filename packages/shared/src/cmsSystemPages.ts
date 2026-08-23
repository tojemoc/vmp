/** Fixed CMS page id for site-wide footer content (not a public route). */
export const CMS_FOOTER_PAGE_ID = 'f0000001-0000-4000-8000-000000000001';

/** Internal slug — reserved; footer content is rendered in AppFooter, not at this URL. */
export const CMS_FOOTER_SLUG = '_footer';

export const CMS_PERSONAL_DATA_PAGE_ID = 'cms-page-personal-data';

/**
 * System page ids that use the `cms-page-*` stable-string convention.
 * Keep this list in sync when adding a new system CMS page — also add the
 * constant to `CMS_SYSTEM_PAGE_IDS` via the spread below.
 */
export const CMS_SYSTEM_CMS_PAGE_IDS = [CMS_PERSONAL_DATA_PAGE_ID] as const;

const CMS_SYSTEM_PAGE_IDS = new Set<string>([CMS_FOOTER_PAGE_ID, ...CMS_SYSTEM_CMS_PAGE_IDS]);

/** UUID-shaped ids (created pages + footer) or stable system ids like `cms-page-personal-data`. */
const CMS_PAGE_ID_PATH_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|cms-page-[a-z0-9-]+)$/i;

export function isCmsSystemPageId(id: string): boolean {
  return CMS_SYSTEM_PAGE_IDS.has(id);
}

export function isCmsSystemSlug(slug: string): boolean {
  return slug === CMS_FOOTER_SLUG;
}

/**
 * True when a `/api/pages/:segment` path should be treated as a page id
 * (admin GET/PUT/DELETE, publish, revisions) rather than a public slug.
 *
 * Accepts any `cms-page-*` segment so future system pages route correctly.
 * Delete/slug locks still require an entry in `CMS_SYSTEM_PAGE_IDS` via
 * `isCmsSystemPageId` — register new system pages there explicitly.
 */
export function isCmsPageIdPathSegment(segment: string): boolean {
  return CMS_PAGE_ID_PATH_RE.test(segment);
}
