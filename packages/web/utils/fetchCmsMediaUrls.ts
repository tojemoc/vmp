/**
 * Resolve CMS media IDs to public URLs in a single batch request.
 */
export async function fetchCmsMediaUrls(
  apiUrl: string,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}

  const base = String(apiUrl || '').replace(/\/$/, '')
  const query = unique.map((id) => encodeURIComponent(id)).join(',')
  try {
    const res = await $fetch<{ media: Array<{ id: string; url?: string }> }>(
      `${base}/api/cms/media/batch?ids=${query}`,
    )
    const urls: Record<string, string> = {}
    for (const item of res.media ?? []) {
      if (item.id && item.url) urls[item.id] = item.url
    }
    return urls
  } catch {
    return {}
  }
}
