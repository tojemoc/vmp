import { isChunkLoadErrorReason, shouldAttemptChunkReload } from '~/utils/chunkLoadRecovery'

export default defineNuxtPlugin(() => {
  function reloadOnceForFreshAssets() {
    if (!shouldAttemptChunkReload(window.sessionStorage)) return
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
