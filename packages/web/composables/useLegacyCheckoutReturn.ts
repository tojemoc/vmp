import strings from '~/utils/strings'

/**
 * After legacy (Qerko/eshop) checkout, the gateway redirects to return_url with ?legacy_order={orderId}.
 * Complete the order server-side and poll subscription until active.
 */
export function useLegacyCheckoutReturn() {
  const route = useRoute()
  const config = useRuntimeConfig()
  const apiUrl = config.public.apiUrl as string
  const { authHeader, fetchSubscription, subscription } = useAuth()

  const legacyOrderId = computed(() => {
    const id = typeof route.query.legacy_order === 'string' ? route.query.legacy_order.trim() : ''
    return id.length > 0 ? id : ''
  })

  const returningFromLegacy = computed(() => legacyOrderId.value.length > 0)

  async function completeLegacyCheckoutReturn(): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
    const orderId = legacyOrderId.value
    if (!orderId) return { ok: false }

    try {
      const completeRes = await fetch(`${apiUrl}/api/payments/legacy/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ orderId }),
      })
      const completeData = await completeRes.json().catch(() => ({}))
      if (!completeRes.ok) {
        return { ok: false, error: completeData.error ?? strings.checkoutStartFailed }
      }

      const MAX_ATTEMPTS = 5
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await fetchSubscription()
        const status = subscription.value?.status
        if (status === 'active' || status === 'trialing') {
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

  async function clearLegacyOrderQuery(extraQuery: Record<string, string> = {}) {
    const nextQuery = { ...route.query, ...extraQuery }
    delete nextQuery.legacy_order
    await navigateTo({ path: route.path, query: nextQuery }, { replace: true })
  }

  return {
    legacyOrderId,
    returningFromLegacy,
    completeLegacyCheckoutReturn,
    clearLegacyOrderQuery,
  }
}
