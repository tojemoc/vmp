import {
  applyPostHogConsentToClient,
  POSTHOG_ANALYTICS_CONSENT_KEY,
  type PostHogConsentValue,
} from '~/utils/posthogConsent';

const consent = ref<PostHogConsentValue | null>(null);
const loaded = ref(false);
let storageListenerCount = 0;

function readConsent(): PostHogConsentValue | null {
  if (!import.meta.client) return null;
  try {
    const raw = localStorage.getItem(POSTHOG_ANALYTICS_CONSENT_KEY);
    if (raw === 'granted' || raw === 'denied') return raw;
  } catch {
    // Treat unreadable storage as unset.
  }
  return null;
}

function writeConsent(value: PostHogConsentValue): void {
  consent.value = value;
  if (!import.meta.client) return;
  try {
    localStorage.setItem(POSTHOG_ANALYTICS_CONSENT_KEY, value);
  } catch {
    // Best effort — in-memory state still applies for this session.
  }
}

function syncConsentToPostHogClient(granted: boolean): void {
  if (!import.meta.client) return;
  const posthog = usePostHog();
  if (!posthog) return;
  applyPostHogConsentToClient(posthog, granted);
}

function applyStoredConsent(): void {
  consent.value = readConsent();
  syncConsentToPostHogClient(consent.value === 'granted');
}

function onStorage(event: StorageEvent): void {
  if (event.key !== POSTHOG_ANALYTICS_CONSENT_KEY) return;
  applyStoredConsent();
}

function attachStorageListener(): void {
  if (!import.meta.client) return;
  if (storageListenerCount === 0) {
    window.addEventListener('storage', onStorage);
  }
  storageListenerCount++;
}

function detachStorageListener(): void {
  if (!import.meta.client || storageListenerCount === 0) return;
  storageListenerCount--;
  if (storageListenerCount === 0) {
    window.removeEventListener('storage', onStorage);
  }
}

/**
 * Explicit GDPR consent for PostHog analytics (separate from the informational
 * personal-data notice banner).
 */
export function usePostHogConsent() {
  onMounted(() => {
    if (!loaded.value) {
      applyStoredConsent();
      loaded.value = true;
    }
    attachStorageListener();
  });

  onUnmounted(() => {
    detachStorageListener();
  });

  const hasAnalyticsConsent = computed(() => consent.value === 'granted');
  const analyticsConsentDecided = computed(() => consent.value !== null);
  const showAnalyticsConsentPrompt = computed(
    () => import.meta.client && loaded.value && consent.value === null,
  );

  function grantAnalyticsConsent(): void {
    writeConsent('granted');
    syncConsentToPostHogClient(true);
  }

  function denyAnalyticsConsent(): void {
    writeConsent('denied');
    syncConsentToPostHogClient(false);
  }

  return {
    analyticsConsent: readonly(consent),
    hasAnalyticsConsent,
    analyticsConsentDecided,
    showAnalyticsConsentPrompt,
    grantAnalyticsConsent,
    denyAnalyticsConsent,
  };
}
