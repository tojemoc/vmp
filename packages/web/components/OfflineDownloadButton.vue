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
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const record = ref<Awaited<ReturnType<typeof getDownloadRecord>>>(null)
const progress = ref({ bytesDownloaded: 0, totalBytes: 0, filesCompleted: 0, filesTotal: 0, status: null as string | null })

let unsubscribe: (() => void) | null = null
let mounted = false

const renditionOptions: OfflineRendition[] = ['480p', '720p', '1080p']

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
  document.addEventListener('click', closeMenuFromDocument)
})

onUnmounted(() => {
  mounted = false
  unsubscribe?.()
  unsubscribe = null
  document.removeEventListener('click', closeMenuFromDocument)
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
  if (!progress.value.totalBytes) return 0
  return Math.min(100, Math.round((progress.value.bytesDownloaded / progress.value.totalBytes) * 100))
})
const isActive = computed(() => status.value === 'downloading' || isDownloadActive(props.videoId))
const showProgress = computed(() => isActive.value || status.value === 'paused')

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

async function handleDownload() {
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
  <div
    v-if="offlineDownloadsEnabled && canDownload && !loading"
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
        <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v2H5v-2z" />
      </svg>
      <span
        v-if="status === 'completed' || status === 'update_available'"
        class="watch-offline-download-badge"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="menuOpen"
      class="watch-offline-download-menu"
      role="menu"
      :aria-label="strings.offlineDownloadMenuLabel"
      @click.stop
    >
      <p class="watch-offline-download-menu-title">{{ strings.offlineDownloadTitle }}</p>

      <div v-if="showProgress" class="space-y-2 mb-3">
        <div class="h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div class="h-full bg-blue-500 transition-all" :style="{ width: `${percent}%` }" />
        </div>
        <p class="text-xs text-white/80">{{ strings.offlineDownloadProgress(percent) }}</p>
        <button
          v-if="isActive"
          type="button"
          class="watch-offline-download-menu-item"
          role="menuitem"
          @click="handlePause"
        >
          {{ strings.offlineDownloadPause }}
        </button>
        <button
          v-else-if="status === 'paused'"
          type="button"
          class="watch-offline-download-menu-item"
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
          class="watch-offline-download-menu-item"
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
          class="watch-offline-download-menu-item watch-offline-download-menu-primary"
          role="menuitem"
          :disabled="working"
          @click="handleDownload"
        >
          {{ working ? strings.offlineDownloadWorking : strings.offlineDownloadStart }}
        </button>

        <button
          v-if="status === 'update_available'"
          type="button"
          class="watch-offline-download-menu-item watch-offline-download-menu-primary"
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
        class="watch-offline-download-menu-item"
        role="menuitem"
        :disabled="working"
        @click="handleRemove"
      >
        {{ strings.offlineDownloadRemove }}
      </button>

      <p v-if="error" class="text-xs text-red-300 mt-2">{{ error }}</p>
      <p v-else-if="status === 'failed' && record?.errorMessage" class="text-xs text-red-300 mt-2">
        {{ record.errorMessage }}
      </p>
    </div>
  </div>
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
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
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
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.92);
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
