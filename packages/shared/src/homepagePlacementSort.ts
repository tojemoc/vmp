/**
 * Canonical video recency for homepage placement and public listings.
 * Mirrors the Worker placement engine so UI ordering matches `/api/homepage/placement`.
 */
export function placementTimestampMs(v: {
  published_at?: string | null
  upload_date?: string | null
}) {
  const primary = v.published_at
  const fallback = v.upload_date
  const s = (typeof primary === 'string' && primary.trim())
    ? primary.trim()
    : (typeof fallback === 'string' && fallback.trim())
      ? fallback.trim()
      : null
  if (!s) return 0
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

export function compareVideosNewestFirst(
  a: { id: string; published_at?: string | null; upload_date?: string | null },
  b: { id: string; published_at?: string | null; upload_date?: string | null },
) {
  const dt = placementTimestampMs(b) - placementTimestampMs(a)
  if (dt !== 0) return dt
  if (a.id > b.id) return -1
  if (a.id < b.id) return 1
  return 0
}
