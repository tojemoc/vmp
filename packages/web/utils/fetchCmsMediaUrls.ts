/**
 * Resolve CMS media IDs to public URLs via the batch endpoint.
 */
const CMS_MEDIA_BATCH_SIZE = 50

export async function fetchCmsMediaUrls(
  apiUrl: string,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}

  const base = String(apiUrl || '').replace(/\/$/, '')
  const urls: Record<string, string> = {}

  for (let i = 0; i < unique.length; i += CMS_MEDIA_BATCH_SIZE) {
    const chunk = unique.slice(i, i + CMS_MEDIA_BATCH_SIZE)
    const query = chunk.map((id) => encodeURIComponent(id)).join(',')
    try {
      const res = await $fetch<{ media: Array<{ id: string; url?: string }> }>(
        `${base}/api/cms/media/batch?ids=${query}`,
      )
      for (const item of res.media ?? []) {
        if (item.id && item.url) urls[item.id] = item.url
      }
    } catch {
      // ignore failed chunk — caller treats missing IDs as absent media
    }
  }

  return urls
}
