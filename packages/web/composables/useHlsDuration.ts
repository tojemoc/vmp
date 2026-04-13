/**
 * composables/useHlsDuration.ts
 *
 * Shared HLS playlist duration resolver.
 * Fetches a playlist URL, sums all #EXTINF segment durations, and follows a
 * master playlist to its first variant if no #EXTINF tags are found.
 */

export async function resolvePlaylistDuration(
  playlistUrl: string,
  depth = 0,
): Promise<number | null> {
  if (!playlistUrl || depth > 2) return null
  try {
    const res = await fetch(playlistUrl)
    if (!res.ok) return null
    const text = await res.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

    const extInfLines = lines.filter(l => l.startsWith('#EXTINF:'))
    if (extInfLines.length > 0) {
      const total = extInfLines.reduce((sum, l) => {
        const n = Number.parseFloat(l.slice('#EXTINF:'.length))
        return Number.isFinite(n) ? sum + n : sum
      }, 0)
      return Number.isFinite(total) && total > 0 ? Math.round(total) : null
    }

    // Master playlist — follow first variant stream
    const idx = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'))
    const nextLine = lines[idx + 1]
    if (idx >= 0 && nextLine) {
      return resolvePlaylistDuration(
        new URL(nextLine, playlistUrl).toString(),
        depth + 1,
      )
    }
  } catch { /* silent — caller handles null */ }
  return null
}