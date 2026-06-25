export const CHUNK_RELOAD_ATTEMPTED_AT_KEY = 'vmp_chunk_reload_attempted_at'
export const CHUNK_RELOAD_THROTTLE_MS = 30_000

let fallbackChunkReloadAttemptedAt: number | null = null

const CHUNK_LOAD_ERROR_PATTERNS = [
  'ChunkLoadError',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Loading chunk',
  'Loading CSS chunk',
  '503',
  'Service Unavailable',
]

export function isNuxtAssetUrl(url: string): boolean {
  try {
    const pathname = new URL(url, 'https://placeholder.local').pathname
    return pathname.startsWith('/_nuxt/') || pathname === '/sw.js' || /^\/workbox-[\w-]+\.js$/.test(pathname)
  } catch {
    return false
  }
}

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
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  now = Date.now(),
): boolean {
  if (fallbackChunkReloadAttemptedAt !== null && now - fallbackChunkReloadAttemptedAt < CHUNK_RELOAD_THROTTLE_MS) {
    return false
  }

  if (!storage) {
    fallbackChunkReloadAttemptedAt = now
    return true
  }

  try {
    const storedAttempt = storage.getItem(CHUNK_RELOAD_ATTEMPTED_AT_KEY)
    if (storedAttempt !== null) {
      const lastAttempt = Number(storedAttempt)
      if (Number.isFinite(lastAttempt) && now - lastAttempt < CHUNK_RELOAD_THROTTLE_MS) {
        return false
      }
    }
    storage.setItem(CHUNK_RELOAD_ATTEMPTED_AT_KEY, String(now))
  } catch {
    fallbackChunkReloadAttemptedAt = now
  }

  return true
}
