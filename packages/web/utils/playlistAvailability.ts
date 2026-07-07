export type PlaylistUnavailableCode = 'storage_unavailable' | 'media_not_available' | 'unknown'

export type PlaylistAvailabilityResult =
  | { ok: true }
  | { ok: false, code: PlaylistUnavailableCode }

function parseProxyErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const code = (payload as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** Preflight a proxied HLS manifest before handing it to the player. */
export async function checkPlaylistAvailability(
  playlistUrl: string,
  signal?: AbortSignal,
): Promise<PlaylistAvailabilityResult> {
  if (!playlistUrl?.trim()) {
    return { ok: false, code: 'media_not_available' }
  }

  try {
    const res = await fetch(playlistUrl, { method: 'GET', signal })
    if (res.ok) return { ok: true }

    const payload = await res.json().catch(() => null)
    const code = parseProxyErrorCode(payload)

    if (code === 'storage_unavailable' || res.status === 502) {
      return { ok: false, code: 'storage_unavailable' }
    }
    if (code === 'media_not_available' || res.status === 404) {
      return { ok: false, code: 'media_not_available' }
    }
    return { ok: false, code: 'unknown' }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { ok: false, code: 'storage_unavailable' }
  }
}

export function isPlaybackUnavailableCode(
  code: PlaylistUnavailableCode,
): code is 'storage_unavailable' | 'media_not_available' {
  return code === 'storage_unavailable' || code === 'media_not_available'
}
