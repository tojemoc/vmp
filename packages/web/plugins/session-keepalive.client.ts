/**
 * Keeps JWT + refresh cookie alive when the PWA returns from background (iOS throttles timers).
 */
export default defineNuxtPlugin(() => {
  const { isLoggedIn, initialised, ensureFreshSession, refreshSession } = useAuth()

  let focusRefreshInFlight = false

  async function refreshOnFocus() {
    if (!initialised.value || focusRefreshInFlight) return
    focusRefreshInFlight = true
    try {
      if (isLoggedIn.value) {
        await ensureFreshSession()
      } else {
        await refreshSession()
      }
    } finally {
      focusRefreshInFlight = false
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshOnFocus()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void refreshOnFocus()
  })
  window.addEventListener('focus', () => { void refreshOnFocus() })
})
