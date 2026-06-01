import strings from '~/utils/strings'

/**
 * After embedded Stripe checkout, Stripe redirects to return_url with ?session_id=cs_...
 * Poll session status and subscription until the webhook has activated access.
 */
export function useStripeCheckoutReturn() {
  const route = useRoute()
  const config = useRuntimeConfig()
  const apiUrl = config.public.apiUrl as string
  const { authHeader, fetchSubscription, subscription } = useAuth()

  const stripeSessionId = computed(() => {
    const id = typeof route.query.session_id === 'string' ? route.query.session_id.trim() : ''
    return id.startsWith('cs_') ? id : ''
  })

  const returningFromStripe = computed(() => stripeSessionId.value.length > 0)

  async function completeStripeCheckoutReturn(): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
    const sessionId = stripeSessionId.value
    if (!sessionId) return { ok: false }

    try {
      const statusRes = await fetch(
        `${apiUrl}/api/payments/session-status?session_id=${encodeURIComponent(sessionId)}`,
        { headers: authHeader(), credentials: 'include' },
      )
      const statusData = await statusRes.json().catch(() => ({}))
      if (!statusRes.ok) {
        return { ok: false, error: statusData.error ?? strings.checkoutStartFailed }
      }

      if (statusData.status !== 'complete') {
        return { ok: false, error: strings.checkoutStripeIncomplete }
      }

      const MAX_ATTEMPTS = 5
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await fetchSubscription()
        if (subscription.value?.status === 'active' || subscription.value?.status === 'trialing') {
          return { ok: true }
        }
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }

      return { ok: false, pending: true }
    } catch {
      return { ok: false, error: strings.networkError }
    }
  }

  async function clearStripeSessionQuery(extraQuery: Record<string, string> = {}) {
    const nextQuery = { ...route.query, ...extraQuery }
    delete nextQuery.session_id
    await navigateTo({ path: route.path, query: nextQuery }, { replace: true })
  }

  return {
    stripeSessionId,
    returningFromStripe,
    completeStripeCheckoutReturn,
    clearStripeSessionQuery,
  }
}
