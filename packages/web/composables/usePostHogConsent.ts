import { getBrowserPostHog } from '~/utils/posthogBrowserClient';
import {
  applyPostHogConsentToClient,
  applyStoredPostHogConsentToClient,
  POSTHOG_ANALYTICS_CONSENT_KEY,
  readPostHogAnalyticsConsent,
  type PostHogConsentValue,
} from '~/utils/posthogConsent';

const consent = ref<PostHogConsentValue | null>(null);
const loaded = ref(false);
let storageListenerCount = 0;

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
  const posthog = getBrowserPostHog();
  // If init is not finished yet, PostHog `loaded` (nuxt.config) reapplies from storage.
  if (!posthog?.__loaded) return;
  try {
    applyPostHogConsentToClient(posthog, granted);
  } catch (err) {
    console.error('[PostHog] consent apply failed', err);
  }
}

function applyStoredConsent(): void {
  consent.value = readPostHogAnalyticsConsent();
  const posthog = getBrowserPostHog();
  if (!posthog?.__loaded) return;
  try {
    applyStoredPostHogConsentToClient(posthog);
  } catch (err) {
    console.error('[PostHog] stored consent apply failed', err);
  }
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
 * Explicit GDPR consent for PostHog product analytics.
 * When PostHog is configured, this prompt replaces the informational personal-data notice banner.
 *
 * Persistence: localStorage. Application to posthog-js: on grant/deny, on mount if
 * already __loaded, and again from the PostHog `loaded` callback in nuxt.config
 * (covers the race where consent was stored before init finished).
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
