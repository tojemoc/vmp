/**
 * Listens for PWA push-login handoff codes (service worker message, URL param, IDB).
 */
import { readStoredPwaHandoffCode, clearStoredPwaHandoffCode } from '~/utils/pwa-auth-idb'

export default defineNuxtPlugin(() => {
  const route = useRoute()
  const router = useRouter()
  const { redeemPwaHandoff, isLoggedIn, initialised, refreshSession } = useAuth()

  let redeemInFlight = false

  async function redeemCode(code: string): Promise<boolean> {
    if (!code || redeemInFlight) return false
    if (isLoggedIn.value) {
      await clearStoredPwaHandoffCode()
      return false
    }
    redeemInFlight = true
    try {
      await redeemPwaHandoff(code)
      await clearStoredPwaHandoffCode()
      return true
    } catch (err) {
      console.warn('[pwa-auth] handoff redeem failed:', err)
      return false
    } finally {
      redeemInFlight = false
    }
  }

  async function tryRedeemFromUrlOrIdb() {
    if (!initialised.value) return

    const fromQuery = typeof route.query.pwa_auth_handoff === 'string'
      ? route.query.pwa_auth_handoff.trim()
      : ''
    if (fromQuery) {
      const ok = await redeemCode(fromQuery)
      if (ok) {
        const q = { ...route.query }
        delete q.pwa_auth_handoff
        await router.replace({ path: route.path, query: q })
      }
      return
    }

    const fromIdb = await readStoredPwaHandoffCode()
    if (fromIdb) await redeemCode(fromIdb)
  }

  async function onAppVisible() {
    if (!initialised.value || isLoggedIn.value) return
    await tryRedeemFromUrlOrIdb()
    if (!isLoggedIn.value) {
      await refreshSession()
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; handoffCode?: string } | null
      if (data?.type === 'pwa_auth_handoff' && typeof data.handoffCode === 'string') {
        void redeemCode(data.handoffCode)
      }
    })
  }

  watch(
    () => initialised.value,
    (ready) => {
      if (ready) void tryRedeemFromUrlOrIdb()
    },
    { immediate: true },
  )

  watch(
    () => route.query.pwa_auth_handoff,
    () => { void tryRedeemFromUrlOrIdb() },
  )

  if (import.meta.client) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void onAppVisible()
    })
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) void onAppVisible()
    })
  }
})
