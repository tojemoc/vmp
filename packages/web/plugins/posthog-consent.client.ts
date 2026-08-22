/**
 * Applies stored PostHog analytics consent after `@posthog/nuxt` initializes the client.
 */
import { applyPostHogConsentToClient, hasPostHogAnalyticsConsent } from '~/utils/posthogConsent';

export default defineNuxtPlugin({
  name: 'posthog-consent',
  dependsOn: ['posthog-client'],
  setup() {
    const config = useRuntimeConfig();
    const publicKey = String(config.public.posthog?.publicKey ?? '').trim();
    if (!publicKey) return;

    const posthog = usePostHog();
    if (!posthog) return;

    applyPostHogConsentToClient(posthog, hasPostHogAnalyticsConsent());
  },
});
