import { initialHydratedState } from '~/utils/hydrationGate';

/**
 * False while this component hydrates server HTML, true from mount onwards (and
 * immediately when it is created by a client-side navigation).
 *
 * plugins/auth.client.ts restores the session before hydration, but SSR — and the
 * prerendered "/" — always render signed out. Gate auth-dependent markup behind this
 * so the first client render matches the server HTML.
 */
export function useHydrated() {
  const nuxtApp = useNuxtApp();
  const hydrated = ref(
    initialHydratedState({ isClient: import.meta.client, isHydrating: !!nuxtApp.isHydrating }),
  );
  onMounted(() => {
    hydrated.value = true;
  });
  return readonly(hydrated);
}
