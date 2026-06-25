import {
  getCriticalAssetUrl,
  isChunkLoadErrorReason,
  isNuxtAssetUrl,
  shouldAttemptChunkReload,
} from '~/utils/chunkLoadRecovery'

export default defineNuxtPlugin(() => {
  function safeReloadAttemptStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    let sessionStorage: Storage | null = null
    try {
      sessionStorage = window.sessionStorage
    } catch {
      sessionStorage = null
    }

    return {
      getItem(key: string) {
        try {
          const value = sessionStorage?.getItem(key)
          if (value !== undefined && value !== null) return value
        } catch {
          // Fall back to history state below.
        }

        try {
          const state = window.history.state as Record<string, unknown> | null
          const value = state?.[key]
          return typeof value === 'string' ? value : null
        } catch {
          return null
        }
      },
      setItem(key: string, value: string) {
        let stored = false
        try {
          sessionStorage?.setItem(key, value)
          stored = sessionStorage !== null
        } catch {
          // Fall back to history state below.
        }

        try {
          const currentState = window.history.state
          const state = currentState && typeof currentState === 'object'
            ? { ...(currentState as Record<string, unknown>) }
            : {}
          state[key] = value
          window.history.replaceState(state, '', window.location.href)
          stored = true
        } catch {
          // shouldAttemptChunkReload has a final in-memory guard if all storage fails.
        }

        if (!stored) {
          throw new Error('Reload attempt storage unavailable')
        }
      },
    }
  }

  function reloadOnceForFreshAssets() {
    if (!shouldAttemptChunkReload(safeReloadAttemptStorage())) return
    window.location.reload()
  }

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnceForFreshAssets()
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!isChunkLoadErrorReason(event.reason)) return
    event.preventDefault()
    reloadOnceForFreshAssets()
  })

  window.addEventListener('error', (event) => {
    const src = getCriticalAssetUrl(event.target)
    if (!src || !isNuxtAssetUrl(src)) return
    reloadOnceForFreshAssets()
  }, true)
})
