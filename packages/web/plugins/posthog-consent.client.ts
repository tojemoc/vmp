/**
 * Applies stored PostHog analytics consent after `@posthog/nuxt` initializes the client.
 * Prefer the PostHog `loaded` callback in nuxt.config for the __loaded race; this covers
 * the case where the plugin runs after init is already complete.
 */
import { getBrowserPostHog, isBrowserPostHogReady } from '~/utils/posthogBrowserClient';
import { applyStoredPostHogConsentToClient } from '~/utils/posthogConsent';
import { isPostHogConfigured } from '~/utils/posthogPublicKey';

export default defineNuxtPlugin({
  name: 'posthog-consent',
  enforce: 'post',
  setup() {
    const config = useRuntimeConfig();
    if (!isPostHogConfigured(config)) return;

    const posthog = getBrowserPostHog();
    if (!posthog || !isBrowserPostHogReady(posthog)) return;

    try {
      applyStoredPostHogConsentToClient(posthog);
    } catch (err) {
      console.error('[PostHog] consent sync failed', err);
    }
  },
});
