import { isChunkLoadErrorReason, shouldAttemptChunkReload } from '~/utils/chunkLoadRecovery'

export default defineNuxtPlugin(() => {
  function safeSessionStorage() {
    try {
      return window.sessionStorage
    } catch {
      return null
    }
  }

  function reloadOnceForFreshAssets() {
    if (!shouldAttemptChunkReload(safeSessionStorage())) return
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
})
