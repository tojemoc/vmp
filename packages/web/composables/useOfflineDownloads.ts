import type { OfflineRendition } from '@vmp/shared'
import {
  checkManifestUpdates,
  getDownloadRecord,
  getStorageSummary,
  isDownloadActive,
  listDownloadRecords,
  pauseOfflineDownload,
  removeOfflineDownload,
  revalidateOfflineLicenses,
  resumeQueuedDownloads,
  startOfflineDownload,
  subscribeDownloadProgress,
} from '~/utils/offline/downloadManager'
import { getOfflinePlaylistUrl } from '~/utils/offline/mediaSourceProvider'
import { isOpfsSupported } from '~/utils/offline/opfsStore'
import type { DownloadProgress, StoredDownload } from '~/utils/offline/types'
import { isInstalledPwa } from '~/utils/pwa'

const downloads = ref<StoredDownload[]>([])
const storageSummary = ref({ usedBytes: 0, quotaBytes: null as number | null, downloadCount: 0 })
const progressByVideo = ref<Record<string, DownloadProgress>>({})
const initialised = ref(false)

function offlineDownloadsEnabled(): boolean {
  if (import.meta.server) return false
  return isInstalledPwa() || import.meta.dev
}

export function useOfflineDownloads() {
  const config = useRuntimeConfig()
  const apiUrl = config.public.apiUrl as string
  const { isPremium, authHeader, ensureFreshSession } = useAuth()

  async function refreshDownloads(): Promise<void> {
    downloads.value = await listDownloadRecords()
    storageSummary.value = await getStorageSummary()
  }

  async function initialiseOfflineDownloads(): Promise<void> {
    if (initialised.value || !offlineDownloadsEnabled()) return
    initialised.value = true
    await refreshDownloads()
    const headers = authHeader()
    if (Object.keys(headers).length > 0) {
      await revalidateOfflineLicenses(apiUrl)
      await checkManifestUpdates(apiUrl, headers)
      await resumeQueuedDownloads(apiUrl, headers)
      await refreshDownloads()
    }
  }

  async function startDownload(videoId: string, rendition: OfflineRendition = '720p'): Promise<void> {
    if (!offlineDownloadsEnabled()) {
      throw new Error('Offline downloads require the installed app')
    }
    const ok = await ensureFreshSession()
    if (!ok) throw new Error('Sign in required')
    await startOfflineDownload({
      apiUrl,
      authHeaders: authHeader(),
      videoId,
      rendition,
    })
    await refreshDownloads()
  }

  async function pauseDownload(videoId: string): Promise<void> {
    await pauseOfflineDownload(videoId)
    await refreshDownloads()
  }

  async function removeDownload(videoId: string): Promise<void> {
    await removeOfflineDownload(apiUrl, authHeader(), videoId)
    await refreshDownloads()
  }

  async function getOfflineSource(videoId: string) {
    return getOfflinePlaylistUrl(videoId)
  }

  function watchProgress(videoId: string, handler: (progress: DownloadProgress) => void): () => void {
    return subscribeDownloadProgress(videoId, (progress) => {
      progressByVideo.value = { ...progressByVideo.value, [videoId]: progress }
      handler(progress)
    })
  }

  return {
    downloads: readonly(downloads),
    storageSummary: readonly(storageSummary),
    progressByVideo: readonly(progressByVideo),
    offlineDownloadsEnabled: computed(() => offlineDownloadsEnabled()),
    storageAvailable: computed(() => isOpfsSupported()),
    canDownload: computed(() => offlineDownloadsEnabled() && isPremium.value),
    initialiseOfflineDownloads,
    refreshDownloads,
    startDownload,
    pauseDownload,
    removeDownload,
    getOfflineSource,
    getDownloadRecord,
    isDownloadActive,
    watchProgress,
  }
}
