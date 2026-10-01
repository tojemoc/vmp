/**
 * Applies stored PostHog analytics consent after `@posthog/nuxt` initializes the client
 * and Flagship confirms `posthog` is compiled for this deployment.
 */
import { getBrowserPostHog, isBrowserPostHogReady } from '~/utils/posthogBrowserClient';
import { applyStoredPostHogConsentToClient } from '~/utils/posthogConsent';
import { setPostHogFlagshipCompiled } from '~/utils/posthogFlagshipGate';
import { isPostHogConfigured } from '~/utils/posthogPublicKey';

export default defineNuxtPlugin({
  name: 'posthog-consent',
  enforce: 'post',
  async setup() {
    const config = useRuntimeConfig();
    if (!isPostHogConfigured(config)) return;

    const { hydrate, isCompiled } = useDeploymentFeatures();
    await hydrate();
    const compiled = isCompiled('posthog');
    setPostHogFlagshipCompiled(compiled);
    if (!compiled) {
      const client = getBrowserPostHog();
      client?.opt_out_capturing?.();
      return;
    }

    const posthog = getBrowserPostHog();
    if (!posthog || !isBrowserPostHogReady(posthog)) return;

    try {
      applyStoredPostHogConsentToClient(posthog);
    } catch (err) {
      console.error('[PostHog] consent sync failed', err);
    }
  },
});
