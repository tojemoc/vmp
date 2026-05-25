import { getOrCreatePwaDeviceToken } from '~/utils/pwa'

export function usePwaPushLogin() {
  const config = useRuntimeConfig()
  const apiUrl = config.public.apiUrl as string

  async function init(email: string): Promise<void> {
    const deviceToken = getOrCreatePwaDeviceToken()
    const res = await fetch(`${apiUrl}/api/auth/pwa-push-login/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, deviceToken }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not start sign-in')
  }

  async function subscribeWithPushSubscription(subscription: PushSubscriptionJSON): Promise<{ emailSent: boolean }> {
    const deviceToken = getOrCreatePwaDeviceToken()
    const res = await fetch(`${apiUrl}/api/auth/pwa-push-login/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken, subscription }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not register for sign-in')
    return { emailSent: !!data.emailSent }
  }

  async function deliverMagicLinkToPwa(token: string): Promise<{
    delivered: boolean
    code?: string
    pendingToken?: string
  }> {
    const res = await fetch(`${apiUrl}/api/auth/pwa-push-login/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not deliver sign-in to the app')
    if (data.requiresTwoFactor && typeof data.pendingToken === 'string') {
      return { delivered: false, code: 'requires_2fa', pendingToken: data.pendingToken }
    }
    if (data.code === 'no_push_subscription' || data.code === 'push_failed') {
      return { delivered: false, code: data.code }
    }
    return { delivered: !!data.delivered }
  }

  return { init, subscribeWithPushSubscription, deliverMagicLinkToPwa }
}
