import { getOrCreatePwaDeviceToken } from '~/utils/pwa'
import strings from '~/utils/strings'

type PwaPushDeliverFailureCode = 'attempt_not_found' | 'no_push_subscription' | 'push_failed'
type PwaPushDeliverCode = 'requires_2fa' | PwaPushDeliverFailureCode

function isDeliverFailureCode(code: unknown): code is PwaPushDeliverFailureCode {
  return code === 'attempt_not_found' || code === 'no_push_subscription' || code === 'push_failed'
}

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
    if (!res.ok) throw new Error(data.error || strings.pwaPushStartFailed)
  }

  async function subscribeWithPushSubscription(subscription: PushSubscriptionJSON): Promise<{ emailSent: boolean }> {
    const deviceToken = getOrCreatePwaDeviceToken()
    const res = await fetch(`${apiUrl}/api/auth/pwa-push-login/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken, subscription }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || strings.pwaPushRegisterFailed)
    return { emailSent: !!data.emailSent }
  }

  async function deliverMagicLinkToPwa(token: string): Promise<{
    delivered: boolean
    code?: PwaPushDeliverCode
    pendingToken?: string
  }> {
    const res = await fetch(`${apiUrl}/api/auth/pwa-push-login/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.requiresTwoFactor && typeof data.pendingToken === 'string') {
      return { delivered: false, code: 'requires_2fa', pendingToken: data.pendingToken }
    }
    if (isDeliverFailureCode(data.code)) {
      return { delivered: false, code: data.code }
    }
    if (!res.ok) throw new Error(data.error || strings.pwaPushDeliverFailed)
    return { delivered: !!data.delivered }
  }

  return { init, subscribeWithPushSubscription, deliverMagicLinkToPwa }
}
