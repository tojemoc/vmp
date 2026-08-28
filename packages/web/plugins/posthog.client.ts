/**
 * App-specific PostHog identity sync. Initialization, Vue error capture, and
 * source maps come from `@posthog/nuxt` (which wraps posthog-js).
 *
 * Never destructure `identify` / `reset` / `setIdentity` off the client — they need `this`.
 */
import { getBrowserPostHog } from '~/utils/posthogBrowserClient';
import { syncPostHogIdentity } from '~/utils/posthogIdentity';
import { isPostHogConfigured } from '~/utils/posthogPublicKey';

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
    const identityState = {
      supportUserId: null as string | null,
      supportHash: null as string | null,
      analyticsUserId: null as string | null,
    };

    watch(
      [initialised, user, hasAnalyticsConsent],
      ([ready, authUser, consentGranted]) => {
        if (!ready) return;
        // Resolve on each tick so we pick up the Nuxt module client after init.
        const posthogClient = getBrowserPostHog();
        if (!posthogClient) return;
        try {
          syncPostHogIdentity(posthogClient, authUser, consentGranted, identityState);
        } catch (err) {
          console.error('[PostHog] identity sync failed', err);
        }
      },
      { immediate: true },
    );
  },
});
