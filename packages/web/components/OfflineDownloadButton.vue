<script setup lang="ts">
import type { OfflineRendition } from '@vmp/shared'
import { trackOfflineEvent } from '~/utils/offline/analytics'

const props = defineProps<{
  videoId: string
  videoTitle?: string
}>()

const { strings } = useStrings()
const {
  canDownload,
  offlineDownloadsEnabled,
  startDownload,
  pauseDownload,
  removeDownload,
  getDownloadRecord,
  isDownloadActive,
  watchProgress,
  refreshDownloads,
} = useOfflineDownloads()

const rendition = ref<OfflineRendition>('720p')
const loading = ref(true)
const working = ref(false)
const error = ref<string | null>(null)
const record = ref<Awaited<ReturnType<typeof getDownloadRecord>>>(null)
const progress = ref({ bytesDownloaded: 0, totalBytes: 0, filesCompleted: 0, filesTotal: 0, status: null as string | null })

let unsubscribe: (() => void) | null = null
let mounted = false

async function loadState() {
  loading.value = true
  record.value = await getDownloadRecord(props.videoId)
  if (record.value?.rendition) rendition.value = record.value.rendition
  loading.value = false
}

onMounted(async () => {
  mounted = true
  await loadState()
  if (!mounted) return
  unsubscribe = watchProgress(props.videoId, (p) => {
    progress.value = p
    if (p.status === 'completed' || p.status === 'failed' || p.status === 'paused') {
      void loadState()
    }
  })
})

onUnmounted(() => {
  mounted = false
  unsubscribe?.()
  unsubscribe = null
})

const status = computed(() => record.value?.status ?? progress.value.status ?? null)
const percent = computed(() => {
  if (!progress.value.totalBytes) return 0
  return Math.min(100, Math.round((progress.value.bytesDownloaded / progress.value.totalBytes) * 100))
})

async function handleDownload() {
  if (working.value) return
  working.value = true
  error.value = null
  try {
    await startDownload(props.videoId, rendition.value)
    await loadState()
    trackOfflineEvent('offline_download_requested', { videoId: props.videoId, rendition: rendition.value })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : strings.value.offlineDownloadFailed
  } finally {
    working.value = false
  }
}

async function handlePause() {
  await pauseDownload(props.videoId)
  await loadState()
}

async function handleRemove() {
  if (!confirm(strings.value.offlineDownloadRemoveConfirm(props.videoTitle || props.videoId))) return
  working.value = true
  try {
    await removeDownload(props.videoId)
    await refreshDownloads()
    await loadState()
  } finally {
    working.value = false
  }
}
</script>

<template>
  <div
    v-if="offlineDownloadsEnabled && canDownload && !loading"
    class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4 space-y-3"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
          {{ strings.offlineDownloadTitle }}
        </h3>
        <p class="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
          {{ strings.offlineDownloadHint }}
        </p>
      </div>
      <span
        v-if="status === 'completed'"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
      >
        {{ strings.offlineDownloadStatusDownloaded }}
      </span>
      <span
        v-else-if="status === 'update_available'"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
      >
        {{ strings.offlineDownloadStatusUpdateAvailable }}
      </span>
      <span
        v-else-if="status === 'license_expired'"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
      >
        {{ strings.offlineDownloadStatusLicenseExpired }}
      </span>
    </div>

    <div v-if="status === 'downloading' || isDownloadActive(videoId)" class="space-y-2">
      <div class="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          class="h-full bg-blue-600 transition-all"
          :style="{ width: `${percent}%` }"
        />
      </div>
      <p class="text-xs text-gray-600 dark:text-gray-400">
        {{ strings.offlineDownloadProgress(percent) }}
      </p>
      <button
        type="button"
        class="text-sm font-medium text-gray-700 dark:text-gray-200 hover:underline"
        @click="handlePause"
      >
        {{ strings.offlineDownloadPause }}
      </button>
    </div>

    <div v-else class="flex flex-wrap items-center gap-3">
      <label class="text-xs text-gray-700 dark:text-gray-300">
        {{ strings.offlineDownloadQuality }}
        <select
          v-model="rendition"
          class="ml-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm px-2 py-1"
          :disabled="status === 'completed'"
        >
          <option value="480p">480p</option>
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
        </select>
      </label>

      <button
        v-if="!status || status === 'failed' || status === 'paused'"
        type="button"
        class="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white dark:text-white text-sm font-medium disabled:opacity-50"
        :disabled="working"
        @click="handleDownload"
      >
        {{ working ? strings.offlineDownloadWorking : strings.offlineDownloadStart }}
      </button>

      <button
        v-if="status === 'completed' || status === 'update_available' || status === 'license_expired'"
        type="button"
        class="inline-flex items-center px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        :disabled="working"
        @click="handleRemove"
      >
        {{ strings.offlineDownloadRemove }}
      </button>

      <button
        v-if="status === 'update_available'"
        type="button"
        class="inline-flex items-center px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white dark:text-white text-sm font-medium disabled:opacity-50"
        :disabled="working"
        @click="handleDownload"
      >
        {{ strings.offlineDownloadUpdate }}
      </button>
    </div>

    <p v-if="error" class="text-xs text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-else-if="status === 'failed' && record?.errorMessage" class="text-xs text-red-600 dark:text-red-400">
      {{ record.errorMessage }}
    </p>
  </div>
</template>
