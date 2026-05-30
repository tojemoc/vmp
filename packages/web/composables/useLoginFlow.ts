import { isInstalledPwa } from '~/utils/pwa'

function safeRedirect(value: string | undefined): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return undefined
  return t
}

export function useLoginFlow() {
  const { isLoggedIn, initialised } = useAuth()
  const { openPwaPushLoginWizard } = usePwaLoginWizardState()

  async function waitForAuthInitialised(): Promise<void> {
    // auth.client.ts only runs in the browser — never block SSR waiting for it.
    if (import.meta.server) return
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

    const authenticated = isLoggedIn.value
    const initialized = initialised.value
    const standalone = isInstalledPwa()
    const route = import.meta.client ? window.location.pathname : '/login'

    console.log('[AUTH ENTRY]', {
      authenticated,
      initialized,
      standalone,
      route,
    })

    if (!initialized) {
      console.warn('[AUTH ENTRY] auth not initialized yet')
    }

    const query: Record<string, string> = {}
    const safe = safeRedirect(redirectPath)
    if (safe) query.redirect = safe

    if (!authenticated && standalone) {
      console.log('[AUTH ENTRY] launching PWA wizard')
      openPwaPushLoginWizard()
      if (route !== '/login') {
        await navigateTo({ path: '/login', query })
      }
      return
    }

    console.log('[AUTH ENTRY] launching normal login')
    await navigateTo({ path: '/login', query })
  }

  return { startLoginFlow, waitForAuthInitialised }
}
