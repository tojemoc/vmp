/**
 * App-specific PostHog identity sync. Initialization, Vue error capture, and
 * source maps come from `@posthog/nuxt`.
 */
import type { AuthUser } from '~/composables/useAuth';

export default defineNuxtPlugin({
  name: 'posthog-identify',
  dependsOn: ['posthog-client'],
  setup() {
    const config = useRuntimeConfig();
    const publicKey = String(config.public.posthog?.publicKey ?? '').trim();
    if (!publicKey) {
      if (import.meta.dev) {
        console.error(
          '[PostHog] Set NUXT_PUBLIC_POSTHOG_KEY and NUXT_PUBLIC_POSTHOG_HOST in the repo-root .env to enable analytics in development.',
        );
      }
      return;
    }

    const posthog = usePostHog();
    if (!posthog) return;
    const { reset, identify } = posthog;

    const { user, initialised } = useAuth();
    let lastIdentifiedUserId: string | null = null;

    function syncIdentity(authUser: AuthUser | null | undefined): void {
      if (!authUser) {
        if (lastIdentifiedUserId !== null) {
          reset();
          lastIdentifiedUserId = null;
        }
        return;
      }

      if (lastIdentifiedUserId === authUser.id) return;

      if (lastIdentifiedUserId !== null) {
        reset();
      }

      identify(authUser.id, {
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
  },
});
