<script setup lang="ts">
  import type { OfflineRendition } from '@vmp/shared';
  import { trackOfflineEvent } from '~/utils/offline/analytics';
  import {
    clearOfflineDownloadReturn,
    consumeOfflineDownloadReturn,
    markOfflineDownloadReturn,
  } from '~/utils/offlineDownloadReturn';
  import { capturePostHogEvent } from '~/utils/posthogClient';
  import {
    canAddToHomeScreenWithoutPrompt,
    canOpenCurrentPageInChrome,
    isInstalledPwa,
    openCurrentPageInChrome,
  } from '~/utils/pwa';

  const props = defineProps<{
    videoId: string;
    videoTitle?: string;
  }>();

  const { strings } = useStrings();
  const { user, accessToken, ensureSubscriptionHydrated } = useAuth();
  const route = useRoute();
  const { $pwa } = useNuxtApp();
  const {
    offlineDownloadsEnabled,
    canDownload,
    startDownload,
    pauseDownload,
    removeDownload,
    getDownloadRecord,
    isDownloadActive,
    watchProgress,
    refreshDownloads,
  } = useOfflineDownloads();

  const rendition = ref<OfflineRendition>('720p');
  const working = ref(false);
  const checkingEntitlement = ref(false);
  const error = ref<string | null>(null);
  const menuOpen = ref(false);
  const pwaModalOpen = ref(false);
  const installingPwa = ref(false);
  const buttonRef = ref<HTMLElement | null>(null);
  const menuRef = ref<HTMLElement | null>(null);
  const menuStyle = ref<Record<string, string>>({});
  const record = ref<Awaited<ReturnType<typeof getDownloadRecord>>>(null);
  const progress = ref({
    bytesDownloaded: 0,
    totalBytes: 0,
    filesCompleted: 0,
    filesTotal: 0,
    status: null as string | null,
  });

  let unsubscribe: (() => void) | null = null;
  let mounted = false;
  let menuPositionCleanup: (() => void) | null = null;
  let resumeHandled = false;

  const renditionOptions: OfflineRendition[] = ['480p', '720p', '1080p'];

  type PwaClient = {
    showInstallPrompt?: boolean;
    install?: () => Promise<void> | void;
  };

  const pwaClient = computed(() => ($pwa ?? null) as PwaClient | null);
  const pwaInstallPromptAvailable = computed(() => Boolean(pwaClient.value?.showInstallPrompt));

  /** True when the surface is capable of hosting the installed PWA. */
  const pwaSupportedSurface = computed(
    () =>
      import.meta.dev ||
      isInstalledPwa() ||
      offlineDownloadsEnabled.value ||
      pwaInstallPromptAvailable.value ||
      canAddToHomeScreenWithoutPrompt(),
  );

  const iosInstallGuide = computed(() => canAddToHomeScreenWithoutPrompt());
  const watchReturnPath = computed(() => `/watch/${encodeURIComponent(props.videoId)}`);

  type ModalBlocker = 'needs_pwa_support' | 'needs_install' | 'needs_subscription';

  /**
   * Determine which modal variant to show when downloads are blocked.
   * - 'needs_pwa_support': browser cannot install or run the offline PWA
   * - 'needs_install': user is not in the installed app yet
   * - 'needs_subscription': user is in the app (or dev) but lacks premium
   */
  const modalBlocker = computed<ModalBlocker>(() => {
    if (!pwaSupportedSurface.value) return 'needs_pwa_support';
    if (!offlineDownloadsEnabled.value) return 'needs_install';
    return 'needs_subscription';
  });

  async function resolveCanDownload(): Promise<boolean> {
    if (!pwaSupportedSurface.value) return false;
    if (!offlineDownloadsEnabled.value) return false;
    const role = user.value?.role;
    // Staff roles can exercise premium workflows without holding a viewer subscription.
    if (role && role !== 'viewer') return true;
    if (!accessToken.value) return false;
    await ensureSubscriptionHydrated();
    return canDownload.value;
  }

  async function loadState() {
    if (!offlineDownloadsEnabled.value) return;
    record.value = await getDownloadRecord(props.videoId);
    if (record.value?.rendition) rendition.value = record.value.rendition;
    syncProgressFromRecord();
  }

  function emptyProgress() {
    return {
      bytesDownloaded: 0,
      totalBytes: 0,
      filesCompleted: 0,
      filesTotal: 0,
      status: null as string | null,
    };
  }

  function syncProgressFromRecord() {
    const rec = record.value;
    if (!rec) {
      progress.value = emptyProgress();
      return;
    }
    if (rec.status === 'downloading' || rec.status === 'paused') {
      progress.value = {
        bytesDownloaded: rec.bytesDownloaded,
        totalBytes: rec.totalBytes,
        filesCompleted: rec.filesCompleted,
        filesTotal: rec.filesTotal,
        status: rec.status,
      };
    }
  }

  onMounted(async () => {
    mounted = true;
    document.addEventListener('click', closeMenuFromDocument);
    await loadState();
    if (!mounted) return;
    if (offlineDownloadsEnabled.value) {
      unsubscribe = watchProgress(props.videoId, (p) => {
        progress.value = p;
        if (p.status === 'completed' || p.status === 'failed' || p.status === 'paused') {
          void loadState();
        }
      });
    }
    await resumeDownloadIfRequested();
  });

  onUnmounted(() => {
    mounted = false;
    unsubscribe?.();
    unsubscribe = null;
    menuPositionCleanup?.();
    menuPositionCleanup = null;
    document.removeEventListener('click', closeMenuFromDocument);
  });

  watch(
    () => props.videoId,
    async () => {
      menuOpen.value = false;
      pwaModalOpen.value = false;
      error.value = null;
      resumeHandled = false;
      await loadState();
    },
  );

  watch(
    () => [route.query.session_id, route.query.legacy_order, route.query.showDownload] as const,
    () => {
      void resumeDownloadIfRequested();
    },
  );

  function closeMenuFromDocument(event: MouseEvent) {
    if (!menuOpen.value) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (buttonRef.value?.contains(target) || menuRef.value?.contains(target)) return;
    menuOpen.value = false;
  }

  function positionMenu() {
    const button = buttonRef.value;
    if (!button || typeof window === 'undefined') return;
    const rect = button.getBoundingClientRect();
    const gap = 8;
    menuStyle.value = {
      position: 'fixed',
      right: `${Math.max(8, window.innerWidth - rect.right)}px`,
      bottom: `${Math.max(8, window.innerHeight - rect.top + gap)}px`,
      zIndex: '80',
    };
  }

  watch(menuOpen, (open) => {
    menuPositionCleanup?.();
    menuPositionCleanup = null;
    if (!open || typeof window === 'undefined') return;
    positionMenu();
    const onResize = () => positionMenu();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    menuPositionCleanup = () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  });

  const status = computed(() => record.value?.status ?? progress.value.status ?? null);
  const isFinalizing = computed(() => {
    const effectiveStatus = progress.value.status ?? record.value?.status ?? null;
    if (effectiveStatus !== 'downloading') return false;
    const filesTotal = progress.value.filesTotal || record.value?.filesTotal || 0;
    const filesCompleted = progress.value.filesCompleted || record.value?.filesCompleted || 0;
    return filesTotal > 0 && filesCompleted >= filesTotal;
  });
  const percent = computed(() => {
    if (isFinalizing.value) return 99;
    const liveTotal = progress.value.totalBytes;
    const liveBytes = progress.value.bytesDownloaded;
    const storedTotal = record.value?.totalBytes ?? 0;
    const storedBytes = record.value?.bytesDownloaded ?? 0;
    const totalBytes = liveTotal > 0 ? liveTotal : storedTotal;
    const bytesDownloaded = liveTotal > 0 ? liveBytes : storedBytes;
    if (!totalBytes) return 0;
    return Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100));
  });
  const isActive = computed(
    () => status.value === 'downloading' || isDownloadActive(props.videoId),
  );
  const showProgress = computed(
    () => isActive.value || status.value === 'paused' || isFinalizing.value,
  );

  /** True when the user can actually start a download right now. */
  const downloadsAvailable = computed(() => canDownload.value);

  function openPwaModal() {
    menuOpen.value = false;
    pwaModalOpen.value = true;
    if (modalBlocker.value === 'needs_subscription') {
      markOfflineDownloadReturn(props.videoId);
    }
  }

  function closePwaModal() {
    pwaModalOpen.value = false;
    clearOfflineDownloadReturn();
  }

  async function handleInstallPwa() {
    const install = pwaClient.value?.install;
    if (!install) return;
    installingPwa.value = true;
    try {
      await install();
      closePwaModal();
    } finally {
      installingPwa.value = false;
    }
  }

  function handleOpenInChrome() {
    openCurrentPageInChrome();
  }

  function checkoutReturnPending(): boolean {
    const sessionId = route.query.session_id;
    const legacyOrder = route.query.legacy_order;
    return (
      (typeof sessionId === 'string' && sessionId.length > 0) ||
      (typeof legacyOrder === 'string' && legacyOrder.length > 0)
    );
  }

  async function stripDownloadReturnQuery() {
    if (route.query.showDownload !== '1') return;
    const nextQuery = { ...route.query };
    delete nextQuery.showDownload;
    await navigateTo({ path: route.path, query: nextQuery }, { replace: true });
  }

  async function resumeDownloadIfRequested() {
    if (!mounted || resumeHandled || checkoutReturnPending()) return;
    const fromQuery = route.query.showDownload === '1';
    const fromStore = consumeOfflineDownloadReturn(props.videoId);
    if (!fromQuery && !fromStore) return;
    resumeHandled = true;
    await stripDownloadReturnQuery();
    if (!mounted) return;
    await openDownloadSurface();
  }

  async function openDownloadSurface() {
    if (checkingEntitlement.value) return;
    checkingEntitlement.value = true;
    try {
      const allowed = await resolveCanDownload();
      if (!allowed) {
        openPwaModal();
        return;
      }
      positionMenu();
      menuOpen.value = true;
    } finally {
      checkingEntitlement.value = false;
    }
  }

  async function toggleMenu() {
    if (checkingEntitlement.value) return;
    if (menuOpen.value) {
      menuOpen.value = false;
      return;
    }
    await openDownloadSurface();
  }

  async function handleDownload() {
    if (checkingEntitlement.value) return;
    checkingEntitlement.value = true;
    try {
      const allowed = await resolveCanDownload();
      if (!allowed) {
        openPwaModal();
        return;
      }
    } finally {
      checkingEntitlement.value = false;
    }
    if (working.value) return;
    working.value = true;
    error.value = null;
    menuOpen.value = false;
    try {
      await startDownload(props.videoId, rendition.value);
      await loadState();
      trackOfflineEvent('offline_download_requested', {
        videoId: props.videoId,
        rendition: rendition.value,
      });
      capturePostHogEvent('offline_download_requested', {
        video_id: props.videoId,
        rendition: rendition.value,
      });
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : strings.value.offlineDownloadFailed;
    } finally {
      working.value = false;
    }
  }

  async function handlePause() {
    await pauseDownload(props.videoId);
    await loadState();
  }

  async function handleRemove() {
    if (!confirm(strings.value.offlineDownloadRemoveConfirm(props.videoTitle || props.videoId)))
      return;
    working.value = true;
    menuOpen.value = false;
    try {
      await removeDownload(props.videoId);
      await refreshDownloads();
      await loadState();
    } finally {
      working.value = false;
    }
  }
</script>

<template>
  <div class="watch-offline-download">
    <button
      ref="buttonRef"
      type="button"
      class="watch-offline-download-button text-white dark:text-white"
      :class="{ 'opacity-70': checkingEntitlement }"
      :aria-label="strings.offlineDownloadMenuLabel"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      :disabled="checkingEntitlement"
      @click.stop="toggleMenu"
    >
      <svg
        class="watch-offline-download-icon"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M12 3a1 1 0 011 1v8.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L11 12.586V4a1 1 0 011-1z"
        />
        <path d="M5 18a1 1 0 011-1h12a1 1 0 110 2H6a1 1 0 01-1-1z" />
      </svg>
      <span
        v-if="showProgress"
        class="watch-offline-download-progress-badge text-[10px] font-semibold text-white dark:text-white"
        aria-live="polite"
      >
        {{ isFinalizing ? strings.offlineDownloadFinalizing : strings.offlineDownloadProgress(percent) }}
      </span>
      <span
        v-else-if="downloadsAvailable && (status === 'completed' || status === 'update_available')"
        class="watch-offline-download-badge"
        aria-hidden="true"
      />
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="menuOpen && downloadsAvailable"
      ref="menuRef"
      class="watch-offline-download-menu"
      role="menu"
      :aria-label="strings.offlineDownloadMenuLabel"
      :style="menuStyle"
      @click.stop
    >
      <p
        class="watch-offline-download-menu-title text-xs font-semibold text-white dark:text-gray-100"
      >
        {{ strings.offlineDownloadTitle }}
      </p>

      <div v-if="showProgress" class="space-y-2 mb-3">
        <div class="h-1.5 rounded-full bg-white/20 dark:bg-gray-700 overflow-hidden">
          <div class="h-full bg-blue-500 transition-all" :style="{ width: `${percent}%` }" />
        </div>
        <p class="text-xs text-white/90 dark:text-gray-300">
          {{ isFinalizing
              ? strings.offlineDownloadFinalizing
              : strings.offlineDownloadProgress(percent) }}
        </p>
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
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
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
      <p
        v-else-if="status === 'failed' && record?.errorMessage"
        class="text-xs text-red-200 dark:text-red-400 mt-2"
      >
        {{ record.errorMessage }}
      </p>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="pwaModalOpen"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      @click.self="closePwaModal"
    >
      <div
        class="relative w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
        :class="modalBlocker === 'needs_subscription' ? 'max-w-lg p-5 sm:p-6' : 'max-w-md p-6'"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-download-pwa-title"
        aria-describedby="offline-download-pwa-desc"
      >
        <button
          type="button"
          class="absolute top-3 right-3 inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          :aria-label="strings.offlineDownloadPwaRequiredDismiss"
          @click="closePwaModal"
        >
          <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clip-rule="evenodd"
            />
          </svg>
        </button>

        <template v-if="modalBlocker === 'needs_pwa_support'">
          <h3
            id="offline-download-pwa-title"
            class="text-lg font-semibold text-gray-900 dark:text-white mb-2 pr-8"
          >
            {{ strings.offlineDownloadPwaUnsupportedTitle }}
          </h3>
          <p id="offline-download-pwa-desc" class="text-sm text-gray-600 dark:text-gray-400 mb-5">
            {{ strings.offlineDownloadPwaUnsupportedMessage }}
          </p>
          <div class="flex flex-col gap-2">
            <button
              v-if="canOpenCurrentPageInChrome()"
              type="button"
              class="w-full px-4 py-2 text-sm font-semibold text-white dark:text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors"
              @click="handleOpenInChrome"
            >
              {{ strings.offlineDownloadPwaUnsupportedOpenChrome }}
            </button>
            <button
              type="button"
              class="w-full px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
              :class="
                  canOpenCurrentPageInChrome()
                    ? 'text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                    : 'text-white dark:text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700'
                "
              @click="closePwaModal"
            >
              {{ strings.offlineDownloadPwaRequiredDismiss }}
            </button>
          </div>
        </template>

        <template v-else-if="modalBlocker === 'needs_install' && iosInstallGuide">
          <div class="flex items-start gap-3 mb-4 pr-8">
            <img
              src="/icons/pwa-192.png"
              alt=""
              class="w-12 h-12 rounded-xl shrink-0"
              width="48"
              height="48"
            >
            <h3
              id="offline-download-pwa-title"
              class="text-lg font-semibold text-gray-900 dark:text-white leading-snug"
            >
              {{ strings.offlineDownloadIosInstallTitle }}
            </h3>
          </div>
          <ul
            id="offline-download-pwa-desc"
            class="space-y-1.5 mb-5 text-sm text-gray-600 dark:text-gray-400 list-disc pl-5"
          >
            <li>{{ strings.offlineDownloadIosInstallBenefit1 }}</li>
            <li>{{ strings.offlineDownloadIosInstallBenefit2 }}</li>
            <li>{{ strings.offlineDownloadIosInstallBenefit3 }}</li>
          </ul>
          <ol class="space-y-4 mb-2">
            <li class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <span
                  class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold shrink-0"
                  aria-hidden="true"
                >
                  1
                </span>
                <span class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ strings.offlineDownloadIosInstallStep1 }}
                </span>
              </div>
              <svg
                class="w-6 h-6 text-gray-700 dark:text-gray-300 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M8.5 14.5L12 11l3.5 3.5M12 18V6M6 3h12a1.5 1.5 0 011.5 1.5v15A1.5 1.5 0 0118 21H6a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 016 3z"
                />
              </svg>
            </li>
            <li class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <span
                  class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold shrink-0"
                  aria-hidden="true"
                >
                  2
                </span>
                <span class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ strings.offlineDownloadIosInstallStep2 }}
                </span>
              </div>
              <span
                class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-900 dark:text-gray-100 shrink-0"
              >
                {{ strings.offlineDownloadIosAddToHomeScreen }}
                <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fill-rule="evenodd"
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
            </li>
          </ol>
        </template>

        <template v-else-if="modalBlocker === 'needs_install'">
          <h3
            id="offline-download-pwa-title"
            class="text-lg font-semibold text-gray-900 dark:text-white mb-2 pr-8"
          >
            {{ strings.offlineDownloadPwaRequiredTitle }}
          </h3>
          <p id="offline-download-pwa-desc" class="text-sm text-gray-600 dark:text-gray-400 mb-5">
            {{ strings.offlineDownloadPwaRequiredMessage }}
          </p>
          <div class="flex flex-col gap-2">
            <button
              v-if="pwaInstallPromptAvailable"
              type="button"
              class="w-full px-4 py-2 text-sm font-semibold text-white dark:text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60"
              :disabled="installingPwa"
              @click="handleInstallPwa"
            >
              {{ strings.pwaInstall }}
            </button>
            <button
              type="button"
              class="w-full px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
              :class="
                  pwaInstallPromptAvailable
                    ? 'text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                    : 'text-white dark:text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700'
                "
              @click="closePwaModal"
            >
              {{ strings.offlineDownloadPwaRequiredDismiss }}
            </button>
          </div>
        </template>

        <template v-else>
          <h3
            id="offline-download-pwa-title"
            class="text-lg font-semibold text-gray-900 dark:text-white mb-2 pr-8"
          >
            {{ strings.offlineDownloadSubRequiredTitle }}
          </h3>
          <p id="offline-download-pwa-desc" class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ strings.offlineDownloadSubRequiredMessage }}
          </p>
          <SubscriptionCheckoutPanel
            :return-path="watchReturnPath"
            reopen-download-on-return
            :active="pwaModalOpen"
            embedded
            compact
          />
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
  .watch-offline-download {
    position: relative;
    display: inline-flex;
  }

  /* Mirror `.watch-icon-button` from the watch page — scoped parent CSS does not apply here. */
  .watch-offline-download-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--media-control-height, 2.25rem);
    min-height: var(--media-control-height, 2.25rem);
    padding: 0.25rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    cursor: pointer;
    transition:
      background 0.15s ease,
      opacity 0.15s ease;
  }

  .watch-offline-download-button:hover,
  .watch-offline-download-button:focus-visible,
  .watch-offline-download-button[aria-expanded="true"] {
    background: rgba(255, 255, 255, 0.12);
  }

  .watch-offline-download-icon {
    width: 1.625rem;
    height: 1.5rem;
    display: block;
    flex-shrink: 0;
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

  .watch-offline-download-progress-badge {
    position: absolute;
    top: -0.35rem;
    right: -0.15rem;
    max-width: 6.5rem;
    padding: 0.1rem 0.25rem;
    border-radius: 0.25rem;
    background: rgba(17, 24, 39, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.18);
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .watch-offline-download-menu {
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
