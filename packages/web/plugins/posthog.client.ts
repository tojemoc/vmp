/**
 * Browser-only PostHog analytics: init, authenticated identify, Vue error capture.
 * No-ops in production when project token/host are unset; dev logs a actionable warning.
 */
import posthog from 'posthog-js';
import type { AuthUser } from '~/composables/useAuth';
import { setPostHogClient } from '~/utils/posthogClient';

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  const projectToken = String(config.public.posthog.projectToken ?? '').trim();
  const apiHost = String(config.public.posthog.host ?? '').trim();

  if (!projectToken || !apiHost) {
    if (import.meta.dev) {
      console.error(
        '[PostHog] Set NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN and NUXT_PUBLIC_POSTHOG_HOST in the repo-root .env to enable analytics in development.',
      );
    }
    return;
  }

  posthog.init(projectToken, {
    api_host: apiHost,
    person_profiles: 'identified_only',
  });
  setPostHogClient(posthog);

  const { user, initialised } = useAuth();
  let lastIdentifiedUserId: string | null = null;

  function syncIdentity(authUser: AuthUser | null | undefined): void {
    if (!authUser) {
      if (lastIdentifiedUserId !== null) {
        posthog.reset();
        lastIdentifiedUserId = null;
      }
      return;
    }

    if (lastIdentifiedUserId === authUser.id) return;

    if (lastIdentifiedUserId !== null) {
      posthog.reset();
    }

    posthog.identify(authUser.id, {
      email: authUser.email,
      role: authUser.role,
    });
    lastIdentifiedUserId = authUser.id;
  }

  watch(
    [initialised, user],
    ([ready, authUser]) => {
      if (!ready) return;
      syncIdentity(authUser);
    },
    { immediate: true },
  );

  nuxtApp.hook('vue:error', (error, _instance, info) => {
    posthog.captureException(error, {
      vue_error_info: String(info),
    });
  });
});
