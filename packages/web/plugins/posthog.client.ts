/**
 * App-specific PostHog identity sync. Initialization, Vue error capture, and
 * source maps come from `@posthog/nuxt` (which wraps posthog-js).
 *
 * Never destructure `identify` / `reset` off the client — they need `this`.
 */
import type { AuthUser } from '~/composables/useAuth';
import {
  getBrowserPostHog,
  isBrowserPostHogReady,
  type PostHogIdentityClient,
} from '~/utils/posthogBrowserClient';
import { isPostHogConfigured } from '~/utils/posthogPublicKey';

function syncPostHogIdentity(
  posthogClient: PostHogIdentityClient,
  authUser: AuthUser | null | undefined,
  hasAnalyticsConsent: boolean,
  lastIdentifiedUserId: { current: string | null },
): void {
  if (!isBrowserPostHogReady(posthogClient)) return;

  if (!hasAnalyticsConsent) {
    if (lastIdentifiedUserId.current !== null) {
      posthogClient.reset?.();
      lastIdentifiedUserId.current = null;
    }
    return;
  }

  if (!authUser) {
    if (lastIdentifiedUserId.current !== null) {
      posthogClient.reset?.();
      lastIdentifiedUserId.current = null;
    }
    return;
  }

  if (lastIdentifiedUserId.current === authUser.id) return;

  if (lastIdentifiedUserId.current !== null) {
    posthogClient.reset?.();
  }

  // GDPR: identify by internal user id only — never email or other PII.
  posthogClient.identify?.(authUser.id, {
    role: authUser.role,
  });
  lastIdentifiedUserId.current = authUser.id;
}

export default defineNuxtPlugin({
  name: 'posthog-identify',
  enforce: 'post',
  setup() {
    const config = useRuntimeConfig();
    if (!isPostHogConfigured(config)) {
      if (import.meta.dev) {
        console.error(
          '[PostHog] Set NUXT_PUBLIC_POSTHOG_KEY (or NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN / NUXT_PUBLIC_POSTHOG_PUBLIC_KEY) and NUXT_PUBLIC_POSTHOG_HOST in the repo-root .env to enable analytics in development.',
        );
      }
      return;
    }

    const { user, initialised } = useAuth();
    const { hasAnalyticsConsent } = usePostHogConsent();
    const lastIdentifiedUserId = { current: null as string | null };

    watch(
      [initialised, user, hasAnalyticsConsent],
      ([ready, authUser, consentGranted]) => {
        if (!ready) return;
        // Resolve on each tick so we pick up the Nuxt module client after init.
        const posthogClient = getBrowserPostHog();
        if (!posthogClient) return;
        try {
          syncPostHogIdentity(posthogClient, authUser, consentGranted, lastIdentifiedUserId);
        } catch (err) {
          console.error('[PostHog] identity sync failed', err);
        }
      },
      { immediate: true },
    );
  },
});
