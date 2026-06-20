export const CHUNK_RELOAD_ATTEMPTED_AT_KEY = 'vmp_chunk_reload_attempted_at'
export const CHUNK_RELOAD_THROTTLE_MS = 30_000

const CHUNK_LOAD_ERROR_PATTERNS = [
  'ChunkLoadError',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Loading chunk',
  'Loading CSS chunk',
]

function errorMessages(reason: unknown): string[] {
  if (reason instanceof Error) {
    return [reason.name, reason.message].filter(Boolean)
  }

  if (typeof reason === 'string') {
    return [reason]
  }

  if (reason && typeof reason === 'object') {
    const record = reason as Record<string, unknown>
    return [record.name, record.message, record.type]
      .filter((value): value is string => typeof value === 'string')
  }

  return []
}

export function isChunkLoadErrorReason(reason: unknown): boolean {
  return errorMessages(reason).some((message) =>
    CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => message.includes(pattern)),
  )
}

export function shouldAttemptChunkReload(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now = Date.now(),
): boolean {
  try {
    const lastAttempt = Number(storage.getItem(CHUNK_RELOAD_ATTEMPTED_AT_KEY))
    if (Number.isFinite(lastAttempt) && now - lastAttempt < CHUNK_RELOAD_THROTTLE_MS) {
      return false
    }
    storage.setItem(CHUNK_RELOAD_ATTEMPTED_AT_KEY, String(now))
  } catch {
    // Reloading is still the safest recovery path when storage is unavailable.
  }

  return true
}
