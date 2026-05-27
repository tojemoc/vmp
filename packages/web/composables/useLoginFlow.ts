import { isInstalledPwa } from '~/utils/pwa'

function safeRedirect(value: string | undefined): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return undefined
  return t
}

export function useLoginFlow() {
  const { isLoggedIn, initialised } = useAuth()

  async function waitForAuthInitialised(): Promise<void> {
    if (initialised.value) return
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => initialised.value,
        (ready) => {
          if (ready) {
            stop()
            resolve()
          }
        },
        { immediate: true },
      )
    })
  }

  async function startLoginFlow(redirectPath?: string): Promise<void> {
    await waitForAuthInitialised()

    const isAuthenticated = isLoggedIn.value
    const installedPwa = isInstalledPwa()
    const routePath = import.meta.client ? window.location.pathname : '/login'

    console.log('[AUTH]', {
      isAuthenticated,
      isInstalledPwa: installedPwa,
      route: routePath,
    })

    const query: Record<string, string> = {}
    const safe = safeRedirect(redirectPath)
    if (safe) query.redirect = safe

    if (!isAuthenticated && installedPwa) {
      console.log('[AUTH] Launching PWA push login wizard')
      query.login = 'pwa-push'
    } else {
      console.log('[AUTH] Launching normal login flow')
    }

    await navigateTo({ path: '/login', query })
  }

  return { startLoginFlow, waitForAuthInitialised }
}
