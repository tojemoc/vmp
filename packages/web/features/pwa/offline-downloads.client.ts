/**
 * Startup license revalidation and queued download resume for offline playback.
 */
export default defineNuxtPlugin(async () => {
  const { isLoggedIn } = useAuth();
  const { initialiseOfflineDownloads, offlineDownloadsEnabled } = useOfflineDownloads();

  async function tryInitialiseOfflineDownloads(): Promise<void> {
    if (!offlineDownloadsEnabled.value) return;
    if (!isLoggedIn.value) return;

    try {
      await initialiseOfflineDownloads();
    } catch (err) {
      console.warn('[offline-downloads] init failed:', err);
    }
  }

  watch(isLoggedIn, (loggedIn, wasLoggedIn) => {
    if (loggedIn && !wasLoggedIn) {
      void tryInitialiseOfflineDownloads();
    }
  });

  await tryInitialiseOfflineDownloads();
});
