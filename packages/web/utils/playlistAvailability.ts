export type PlaylistUnavailableCode = 'storage_unavailable' | 'media_not_available' | 'unknown'

export type PlaylistAvailabilityResult =
  | { ok: true }
  | { ok: false, code: PlaylistUnavailableCode }

const PLAYLIST_PREFLIGHT_TIMEOUT_MS = 12_000

export class PlaybackUnavailableError extends Error {
  override readonly name = 'PlaybackUnavailableError'

  constructor() {
    super('Playback unavailable')
  }
}

export function isPlaybackUnavailableError(err: unknown): err is PlaybackUnavailableError {
  return err instanceof PlaybackUnavailableError
}

export function parseProxyErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const code = (payload as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => s != null)
  if (defined.length === 0) {
    return new AbortController().signal
  }
  if (defined.length === 1) return defined[0]

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  for (const signal of defined) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return controller.signal
}

function timeoutAbortSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  const id = setTimeout(
    () => controller.abort(new DOMException('Playlist preflight timed out', 'TimeoutError')),
    ms,
  )
  controller.signal.addEventListener('abort', () => clearTimeout(id), { once: true })
  return controller.signal
}

function preflightFetchSignal(routeSignal?: AbortSignal): AbortSignal {
  return mergeAbortSignals(routeSignal, timeoutAbortSignal(PLAYLIST_PREFLIGHT_TIMEOUT_MS))
}

/** Preflight a proxied HLS manifest before handing it to the player. */
export async function checkPlaylistAvailability(
  playlistUrl: string,
  signal?: AbortSignal,
): Promise<PlaylistAvailabilityResult> {
  if (!playlistUrl?.trim()) {
    return { ok: false, code: 'media_not_available' }
  }

  const fetchSignal = preflightFetchSignal(signal)

  try {
    const res = await fetch(playlistUrl, { method: 'GET', signal: fetchSignal })
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
