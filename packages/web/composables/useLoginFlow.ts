import { resolveAuthReturnPath, safeRedirectPath } from '~/utils/authRedirect';
import { isIosInstalledPwa } from '~/utils/pwa';

export { resolveAuthReturnPath, safeRedirectPath };

export function useLoginFlow() {
  const nuxtApp = useNuxtApp();
  const { isLoggedIn, initialised } = useAuth();
  const { openPwaPushLoginWizard } = usePwaLoginWizardState();

  async function waitForAuthInitialised(): Promise<void> {
    // auth.client.ts only runs in the browser — never block SSR waiting for it.
    if (import.meta.server) return;
    if (initialised.value) return;
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => initialised.value,
        (ready) => {
          if (ready) {
            stop();
            resolve();
          }
        },
        { immediate: true },
      );
    });
  }

  /**
   * Redirect to login (and optionally open the PWA push-login wizard).
   * When `redirectPath` is omitted, stamps the current route so magic-link /
   * OTP return lands back on the video, article, account, or checkout page.
   * Returns the result of navigateTo so route middleware can `return startLoginFlow(...)`.
   * Do not await navigateTo in a nested async function from middleware — that loses Nuxt context.
   */
  async function startLoginFlow(redirectPath?: string) {
    await waitForAuthInitialised();

    const authenticated = isLoggedIn.value;
    const initialized = initialised.value;
    const standalone = isIosInstalledPwa();
    const route = useRoute();
    const currentPath =
      import.meta.client && typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : route.fullPath;

    if (!initialized && import.meta.dev) {
      console.warn('[AUTH ENTRY] auth not initialized yet');
    }

    const query: Record<string, string> = {};
    const safe = resolveAuthReturnPath(redirectPath, currentPath);
    if (safe) query.redirect = safe;

    const goLogin = () => navigateTo({ path: '/login', query });

    if (!authenticated && standalone) {
      openPwaPushLoginWizard();
      const pathOnly = (currentPath.split('?')[0] || '').replace(/\/$/, '') || '/';
      if (pathOnly !== '/login') {
        return nuxtApp.runWithContext(goLogin);
      }
      return;
    }

    return nuxtApp.runWithContext(goLogin);
  }

  return { startLoginFlow, waitForAuthInitialised };
}
