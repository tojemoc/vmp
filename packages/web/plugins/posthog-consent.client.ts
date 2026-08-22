/**
 * Applies stored PostHog analytics consent after `@posthog/nuxt` initializes the client.
 */
import { getBrowserPostHog } from '~/utils/posthogBrowserClient';
import { applyPostHogConsentToClient, hasPostHogAnalyticsConsent } from '~/utils/posthogConsent';
import { isPostHogConfigured } from '~/utils/posthogPublicKey';

export default defineNuxtPlugin({
  name: 'posthog-consent',
  enforce: 'post',
  setup() {
    const config = useRuntimeConfig();
    if (!isPostHogConfigured(config)) return;

    const posthog = getBrowserPostHog();
    if (!posthog) return;

    applyPostHogConsentToClient(posthog, hasPostHogAnalyticsConsent());
  },
});
