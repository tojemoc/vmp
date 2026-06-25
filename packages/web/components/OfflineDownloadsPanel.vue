<script setup lang="ts">
import type { StoredDownload } from '~/utils/offline/types'

const { strings } = useStrings()
const {
  downloads,
  storageSummary,
  offlineDownloadsEnabled,
  refreshDownloads,
  removeDownload,
  startDownload,
  pauseDownload,
  watchProgress,
  isDownloadActive,
} = useOfflineDownloads()

const loading = ref(true)
const workingId = ref<string | null>(null)
const error = ref<string | null>(null)
const progressByVideo = ref<Record<string, { percent: number; status: string | null }>>({})

const unsubscribeFns: Array<() => void> = []

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function statusLabel(record: StoredDownload): string {
  const s = strings.value
  switch (record.status) {
    case 'completed': return s.offlineDownloadStatusDownloaded
    case 'downloading': return s.offlineDownloadStatusDownloading
    case 'paused': return s.offlineDownloadStatusPaused
    case 'failed': return s.offlineDownloadStatusFailed
    case 'update_available': return s.offlineDownloadStatusUpdateAvailable
    case 'license_expired': return s.offlineDownloadStatusLicenseExpired
    default: return record.status
  }
}

function bindProgressListeners(records: readonly StoredDownload[]) {
  for (const unsub of unsubscribeFns) unsub()
  unsubscribeFns.length = 0
  for (const record of records) {
    if (!['downloading', 'paused', 'failed'].includes(record.status) && !isDownloadActive(record.videoId)) {
      continue
    }
    const unsub = watchProgress(record.videoId, (p) => {
      const percent = p.totalBytes
        ? Math.min(100, Math.round((p.bytesDownloaded / p.totalBytes) * 100))
        : 0
      progressByVideo.value = {
        ...progressByVideo.value,
        [record.videoId]: { percent, status: p.status },
      }
    })
    unsubscribeFns.push(unsub)
  }
}

onMounted(async () => {
  try {
    await refreshDownloads()
    bindProgressListeners(downloads.value)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : strings.value.offlineDownloadFailed
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  for (const unsub of unsubscribeFns) unsub()
})

watch(downloads, (records) => {
  bindProgressListeners(records)
}, { deep: true })

const quotaPercent = computed(() => {
  const { usedBytes, quotaBytes } = storageSummary.value
  if (!quotaBytes || quotaBytes <= 0) return null
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
})

function recordPercent(record: StoredDownload): number | null {
  const live = progressByVideo.value[record.videoId]
  if (live) return live.percent
  if (record.status === 'downloading' && record.totalBytes > 0) {
    return Math.min(100, Math.round((record.bytesDownloaded / record.totalBytes) * 100))
  }
  return null
}

async function handleRemove(record: StoredDownload) {
  if (!confirm(strings.value.offlineDownloadRemoveConfirm(record.videoTitle || record.videoId))) return
  workingId.value = record.videoId
  error.value = null
  try {
    await removeDownload(record.videoId)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : strings.value.offlineDownloadFailed
  } finally {
    workingId.value = null
  }
}

async function handleUpdate(record: StoredDownload) {
  workingId.value = record.videoId
  error.value = null
  try {
    await startDownload(record.videoId, record.rendition)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : strings.value.offlineDownloadFailed
  } finally {
    workingId.value = null
  }
}

async function handlePause(record: StoredDownload) {
  workingId.value = record.videoId
  try {
    await pauseDownload(record.videoId)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : strings.value.offlineDownloadFailed
  } finally {
    workingId.value = null
  }
}
</script>

<template>
  <div
    v-if="offlineDownloadsEnabled"
    class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
  >
    <div>
      <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ strings.offlineDownloadsTitle }}</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ strings.offlineDownloadsIntro }}</p>
    </div>

    <div v-if="storageSummary.downloadCount > 0 || storageSummary.usedBytes > 0" class="space-y-2">
      <div class="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
        <span>{{ strings.offlineStorageUsed(formatBytes(storageSummary.usedBytes)) }}</span>
        <span v-if="storageSummary.quotaBytes">
          {{ strings.offlineStorageQuota(formatBytes(storageSummary.quotaBytes)) }}
        </span>
      </div>
      <div
        v-if="quotaPercent !== null"
        class="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
        role="progressbar"
        :aria-valuenow="quotaPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="h-full bg-blue-600 transition-all" :style="{ width: `${quotaPercent}%` }" />
      </div>
    </div>

    <div v-if="loading" class="h-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />

    <p v-else-if="downloads.length === 0" class="text-sm text-gray-600 dark:text-gray-400">
      {{ strings.offlineDownloadsEmpty }}
    </p>

    <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
      <li
        v-for="record in downloads"
        :key="record.videoId"
        class="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium text-gray-900 dark:text-white truncate">
            {{ record.videoTitle || record.videoId }}
          </p>
          <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {{ record.rendition }} · {{ statusLabel(record) }}
            <span v-if="record.status === 'completed'">
              · {{ formatBytes(record.bytesDownloaded) }}
            </span>
          </p>
          <div
            v-if="recordPercent(record) !== null"
            class="mt-2 space-y-1"
          >
            <div class="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                class="h-full bg-blue-600 transition-all"
                :style="{ width: `${recordPercent(record)}%` }"
              />
            </div>
            <p class="text-xs text-gray-600 dark:text-gray-400">
              {{ strings.offlineDownloadProgress(recordPercent(record) ?? 0) }}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0">
          <NuxtLink
            :to="`/watch/${encodeURIComponent(record.videoId)}`"
            class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {{ strings.offlineDownloadPlay }}
          </NuxtLink>
          <button
            v-if="record.status === 'downloading' || isDownloadActive(record.videoId)"
            type="button"
            class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            :disabled="workingId === record.videoId"
            @click="handlePause(record)"
          >
            {{ strings.offlineDownloadPause }}
          </button>
          <button
            v-if="record.status === 'paused' || record.status === 'failed'"
            type="button"
            class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white dark:text-white disabled:opacity-50"
            :disabled="workingId === record.videoId"
            @click="handleUpdate(record)"
          >
            {{ strings.offlineDownloadResume }}
          </button>
          <button
            v-if="record.status === 'update_available'"
            type="button"
            class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white dark:text-white disabled:opacity-50"
            :disabled="workingId === record.videoId"
            @click="handleUpdate(record)"
          >
            {{ strings.offlineDownloadUpdate }}
          </button>
          <button
            type="button"
            class="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            :disabled="workingId === record.videoId"
            @click="handleRemove(record)"
          >
            {{ strings.offlineDownloadRemove }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
  </div>
</template>
