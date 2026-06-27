/** Strip combining diacritics so č→c, á→a, ý→y, etc. */
export function transliterateToAscii(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Normalize a vanity video slug: transliterate diacritics, lowercase, spaces → hyphens.
 * Example: "Môj článok" → "moj-clanok"
 */
export function sanitizeVideoSlug(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return transliterateToAscii(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidVideoSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

/** Preferred /watch/ path segment: vanity slug when set, otherwise the video id. */
export function canonicalWatchToken(video: { id: string; slug?: string | null }): string {
  const slug = typeof video.slug === 'string' ? video.slug.trim() : ''
  return slug || video.id
}
