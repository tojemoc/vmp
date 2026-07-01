<script setup lang="ts">
import type { OfflineRendition } from '@vmp/shared'
import { trackOfflineEvent } from '~/utils/offline/analytics'

const props = defineProps<{
  videoId: string
  videoTitle?: string
}>()

const { strings } = useStrings()
const { isPremium } = useAuth()
const {
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
const working = ref(false)
const error = ref<string | null>(null)
const menuOpen = ref(false)
const pwaModalOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const record = ref<Awaited<ReturnType<typeof getDownloadRecord>>>(null)
const progress = ref({ bytesDownloaded: 0, totalBytes: 0, filesCompleted: 0, filesTotal: 0, status: null as string | null })

let unsubscribe: (() => void) | null = null
let mounted = false

const renditionOptions: OfflineRendition[] = ['480p', '720p', '1080p']

async function loadState() {
  if (!offlineDownloadsEnabled.value) return
  record.value = await getDownloadRecord(props.videoId)
  if (record.value?.rendition) rendition.value = record.value.rendition
}

onMounted(async () => {
  mounted = true
  await loadState()
  if (!mounted || !offlineDownloadsEnabled.value) return
  unsubscribe = watchProgress(props.videoId, (p) => {
    progress.value = p
    if (p.status === 'completed' || p.status === 'failed' || p.status === 'paused') {
      void loadState()
    }
  })
  document.addEventListener('click', closeMenuFromDocument)
})

onUnmounted(() => {
  mounted = false
  unsubscribe?.()
  unsubscribe = null
  document.removeEventListener('click', closeMenuFromDocument)
})

watch(() => props.videoId, async () => {
  menuOpen.value = false
  pwaModalOpen.value = false
  error.value = null
  await loadState()
})

function closeMenuFromDocument(event: MouseEvent) {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (menuRef.value && target && !menuRef.value.contains(target)) {
    menuOpen.value = false
  }
}

const status = computed(() => record.value?.status ?? progress.value.status ?? null)
const percent = computed(() => {
  const liveTotal = progress.value.totalBytes
  const liveBytes = progress.value.bytesDownloaded
  const storedTotal = record.value?.totalBytes ?? 0
  const storedBytes = record.value?.bytesDownloaded ?? 0
  const totalBytes = liveTotal > 0 ? liveTotal : storedTotal
  const bytesDownloaded = liveTotal > 0 ? liveBytes : storedBytes
  if (!totalBytes) return 0
  return Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100))
})
const isActive = computed(() => status.value === 'downloading' || isDownloadActive(props.videoId))
const showProgress = computed(() => isActive.value || status.value === 'paused')
const downloadsAvailable = computed(() => offlineDownloadsEnabled.value && isPremium.value)

function openPwaModal() {
  menuOpen.value = false
  pwaModalOpen.value = true
}

function closePwaModal() {
  pwaModalOpen.value = false
}

function toggleMenu() {
  if (!downloadsAvailable.value) {
    openPwaModal()
    return
  }
  menuOpen.value = !menuOpen.value
}

async function handleDownload() {
  if (!downloadsAvailable.value) {
    openPwaModal()
    return
  }
  if (working.value) return
  working.value = true
  error.value = null
  menuOpen.value = false
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
  menuOpen.value = false
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
  <template v-if="isPremium">
    <div
      ref="menuRef"
      class="watch-offline-download"
    >
      <button
        type="button"
        class="watch-icon-button watch-offline-download-button"
        :aria-label="strings.offlineDownloadMenuLabel"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        @click.stop="toggleMenu"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 10l5 5 5-5H7z" />
        </svg>
        <span
          v-if="downloadsAvailable && (status === 'completed' || status === 'update_available')"
          class="watch-offline-download-badge"
          aria-hidden="true"
        />
      </button>

      <div
        v-if="menuOpen && downloadsAvailable"
        class="watch-offline-download-menu"
        role="menu"
        :aria-label="strings.offlineDownloadMenuLabel"
        @click.stop
      >
        <p class="watch-offline-download-menu-title text-xs font-semibold text-white dark:text-gray-100">{{ strings.offlineDownloadTitle }}</p>

        <div v-if="showProgress" class="space-y-2 mb-3">
          <div class="h-1.5 rounded-full bg-white/20 dark:bg-gray-700 overflow-hidden">
            <div class="h-full bg-blue-500 transition-all" :style="{ width: `${percent}%` }" />
          </div>
          <p class="text-xs text-white/90 dark:text-gray-300">{{ strings.offlineDownloadProgress(percent) }}</p>
          <button
            v-if="isActive"
            type="button"
            class="watch-offline-download-menu-item text-sm text-white dark:text-gray-200"
            role="menuitem"
            @click="handlePause"
          >
            {{ strings.offlineDownloadPause }}
          </button>
          <button
            v-else-if="status === 'paused'"
            type="button"
            class="watch-offline-download-menu-item text-sm text-white dark:text-gray-200"
            role="menuitem"
            :disabled="working"
            @click="handleDownload"
          >
            {{ strings.offlineDownloadResume }}
          </button>
        </div>

        <template v-else>
          <button
            v-for="option in renditionOptions"
            :key="option"
            type="button"
            class="watch-offline-download-menu-item text-sm text-white dark:text-gray-200"
            role="menuitemradio"
            :aria-checked="rendition === option"
            :disabled="working || status === 'completed'"
            @click="rendition = option"
          >
            <span>{{ option }}</span>
            <svg
              v-if="rendition === option"
              class="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </button>

          <button
            v-if="!status || status === 'failed' || status === 'paused'"
            type="button"
            class="watch-offline-download-menu-item watch-offline-download-menu-primary text-sm text-white dark:text-white"
            role="menuitem"
            :disabled="working"
            @click="handleDownload"
          >
            {{ working ? strings.offlineDownloadWorking : strings.offlineDownloadStart }}
          </button>

          <button
            v-if="status === 'update_available'"
            type="button"
            class="watch-offline-download-menu-item watch-offline-download-menu-primary text-sm text-white dark:text-white"
            role="menuitem"
            :disabled="working"
            @click="handleDownload"
          >
            {{ strings.offlineDownloadUpdate }}
          </button>
        </template>

        <button
          v-if="status === 'completed' || status === 'update_available' || status === 'license_expired'"
          type="button"
          class="watch-offline-download-menu-item text-sm text-white dark:text-gray-200"
          role="menuitem"
          :disabled="working"
          @click="handleRemove"
        >
          {{ strings.offlineDownloadRemove }}
        </button>

        <p v-if="error" class="text-xs text-red-200 dark:text-red-400 mt-2">{{ error }}</p>
        <p v-else-if="status === 'failed' && record?.errorMessage" class="text-xs text-red-200 dark:text-red-400 mt-2">
          {{ record.errorMessage }}
        </p>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="pwaModalOpen"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        role="presentation"
        @click.self="closePwaModal"
      >
        <div
          class="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="offline-download-pwa-title"
          aria-describedby="offline-download-pwa-desc"
        >
          <h3 id="offline-download-pwa-title" class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {{ strings.offlineDownloadPwaRequiredTitle }}
          </h3>
          <p id="offline-download-pwa-desc" class="text-sm text-gray-600 dark:text-gray-400 mb-5">
            {{ strings.offlineDownloadPwaRequiredMessage }}
          </p>
          <button
            type="button"
            class="w-full px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            @click="closePwaModal"
          >
            {{ strings.offlineDownloadPwaRequiredDismiss }}
          </button>
        </div>
      </div>
    </Teleport>
  </template>
</template>

<style scoped>
.watch-offline-download {
  position: relative;
  display: inline-flex;
}

.watch-offline-download-button {
  position: relative;
}

.watch-offline-download-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: #22c55e;
}

.watch-offline-download-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  min-width: 11rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(17, 24, 39, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.watch-offline-download-menu-title {
  margin-bottom: 0.5rem;
}

.watch-offline-download-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: 0.375rem;
  text-align: left;
}

.watch-offline-download-menu-item:hover,
.watch-offline-download-menu-item:focus-visible,
.watch-offline-download-menu-item[aria-checked="true"] {
  background: rgba(255, 255, 255, 0.08);
}

.watch-offline-download-menu-primary {
  margin-top: 0.25rem;
  background: rgba(37, 99, 235, 0.85);
}

.watch-offline-download-menu-primary:hover,
.watch-offline-download-menu-primary:focus-visible {
  background: rgba(29, 78, 216, 0.95);
}
</style>
