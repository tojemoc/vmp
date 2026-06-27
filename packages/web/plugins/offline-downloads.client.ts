/**
 * Startup license revalidation and queued download resume for offline playback.
 */
export default defineNuxtPlugin(async () => {
  const { isLoggedIn } = useAuth()
  const { initialiseOfflineDownloads, offlineDownloadsEnabled } = useOfflineDownloads()

  if (!offlineDownloadsEnabled.value) return
  if (!isLoggedIn.value) return

  try {
    await initialiseOfflineDownloads()
  } catch (err) {
    console.warn('[offline-downloads] startup init failed:', err)
  }
})
