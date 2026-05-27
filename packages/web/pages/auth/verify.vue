<!-- packages/web/pages/auth/verify.vue -->
<!--
  Landing page for magic link clicks.
  URL: /auth/verify?token=<raw_token>  or  /auth/verify?handoff=<code>&redirect=...

  On iPhone/iPad Safari (not the installed web app), exchanges the email token for
  a short-lived handoff code so the session can be created inside the Home Screen app.
-->
<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
    <div class="w-full max-w-sm text-center">

      <!-- Verifying -->
      <div v-if="state === 'verifying'" class="space-y-4">
        <div class="inline-block w-10 h-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin"></div>
        <p class="text-gray-400 text-sm">{{ strings.authVerifySigningIn }}</p>
      </div>

      <!-- PWA push-login: confirm signing into Home Screen app -->
      <div v-else-if="state === 'pwa_push_prompt'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-white mb-2">{{ strings.authVerifyPwaPushTitle }}</h2>
        </div>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            :disabled="delivering"
            @click="deliverToInstalledPwa"
          >
            {{ delivering ? strings.authVerifyPwaPushSending : strings.authVerifyPwaPushYes }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            :disabled="delivering"
            @click="signInHereInstead"
          >
            {{ strings.authVerifyPwaPushNo }}
          </button>
        </div>
      </div>

      <div v-else-if="state === 'pwa_push_done'" class="space-y-4">
        <p class="text-gray-300 text-sm leading-relaxed">{{ strings.authVerifyPwaPushDone }}</p>
      </div>

      <!-- iOS Safari: wait for user to open installed PWA or choose Safari -->
      <div v-else-if="state === 'handoff_wait'" class="space-y-6 text-left">
        <div>
          <h2 class="text-lg font-semibold text-white mb-2">{{ strings.authVerifyHandoffTitle }}</h2>
          <p class="text-gray-400 text-sm leading-relaxed">{{ strings.authVerifyHandoffBody }}</p>
        </div>
        <div class="flex flex-col gap-3">
          <button
            type="button"
            class="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            @click="finishInSafari"
          >
            {{ strings.authVerifyHandoffContinueSafari }}
          </button>
          <button
            type="button"
            class="w-full px-5 py-2.5 border border-gray-600 hover:border-gray-500 text-gray-200 text-sm font-medium rounded-lg transition-colors"
            @click="copyHandoffUrl"
          >
            {{ copyHint }}
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="state === 'error'" class="space-y-6">
        <div class="w-14 h-14 mx-auto rounded-full bg-red-950 border border-red-800 flex items-center justify-center">
          <svg class="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-white mb-1">Link invalid</h2>
          <p class="text-gray-400 text-sm leading-relaxed">{{ errorMessage }}</p>
        </div>
        <button
          type="button"
          class="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          @click="requestNewLink"
        >
          Request a new link
        </button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, navigateTo } from '#app'
import strings from '~/utils/strings'
import { isInstalledPwa } from '~/utils/pwa'

const route = useRoute()
const { verify, magicPwaHandoff, redeemPwaHandoff, canEditContent, user } = useAuth()
const { deliverMagicLinkToPwa } = usePwaPushLogin()
const { startLoginFlow } = useLoginFlow()

function isDisplayStandalone() {
  if (import.meta.server) return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosLike() {
  if (import.meta.server) return false
  const ua = navigator.userAgent || ''
  return /iP(ad|hone|od)/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** iPhone/iPad in Mobile Safari (or in-app browsers) but not the Home Screen web app. */
function shouldUseIosMagicHandoff(): boolean {
  return isIosLike() && !isDisplayStandalone()
}

/** After handoff code is in the URL: defer redeem in iOS Safari so cookies attach where the user chooses. */
function shouldDeferHandoffRedeem(): boolean {
  return isIosLike() && !isDisplayStandalone()
}

// Must start with a single slash; rejects //evil.com and external URLs.
function safeRedirect(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const t = value.trim()
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return fallback
  return t
}

function firstQueryString(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim()
  return ''
}

type State = 'verifying' | 'error' | 'handoff_wait' | 'pwa_push_prompt' | 'pwa_push_done'
const state = ref<State>('verifying')
const errorMessage = ref('')
const copyHint = ref(strings.authVerifyHandoffCopyLink)
const handoffCodeForSafari = ref<string | null>(null)
const magicTokenForFlow = ref<string | null>(null)
const delivering = ref(false)

async function navigateAfterFullSession(redirect: string) {
  const u = user.value
  if (!u) {
    await navigateTo(redirect)
    return
  }
  if (canEditContent.value && u.totpRequired && !u.totpEnabled) {
    await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`)
    return
  }
  await navigateTo(redirect)
}

async function finishInSafari() {
  const code = handoffCodeForSafari.value
  if (!code) return
  state.value = 'verifying'
  try {
    const redirect = safeRedirect(route.query.redirect, '/')
    await redeemPwaHandoff(code)
    if (!user.value) throw new Error('Sign-in incomplete')
    await navigateAfterFullSession(redirect)
  } catch (e: any) {
    state.value = 'error'
    errorMessage.value = e?.message || 'Something went wrong. Please request a new sign-in link.'
  }
}

function isPwaPushLoginLink(): boolean {
  const pwa = firstQueryString(route.query.pwa)
  return pwa === '1' && !isInstalledPwa()
}

async function deliverToInstalledPwa() {
  const token = magicTokenForFlow.value
  if (!token) return
  delivering.value = true
  errorMessage.value = ''
  try {
    const result = await deliverMagicLinkToPwa(token)
    if (result.code === 'requires_2fa' && result.pendingToken) {
      const redirect = safeRedirect(route.query.redirect, '/')
      await navigateTo(
        `/auth/2fa?pending=${encodeURIComponent(result.pendingToken)}&redirect=${encodeURIComponent(redirect)}`,
      )
      return
    }
    if (!result.delivered) {
      if (result.code === 'no_push_subscription' || result.code === 'push_failed') {
        await signInHereInstead()
        return
      }
      state.value = 'error'
      errorMessage.value = strings.authVerifyPwaPushDeliverFailed
      return
    }
    state.value = 'pwa_push_done'
  } catch (e: unknown) {
    state.value = 'error'
    errorMessage.value = e instanceof Error ? e.message : strings.authVerifyPwaPushDeliverFailed
  } finally {
    delivering.value = false
  }
}

async function signInHereInstead() {
  const token = magicTokenForFlow.value
  if (!token) return
  state.value = 'verifying'
  await runNormalTokenVerify(token)
}

async function runNormalTokenVerify(token: string) {
  const redirect = safeRedirect(route.query.redirect, '/')
  try {
    if (shouldUseIosMagicHandoff()) {
      const mh = await magicPwaHandoff(token)
      if (mh.kind === '2fa') {
        await navigateTo(
          `/auth/2fa?pending=${encodeURIComponent(mh.pendingToken)}&redirect=${encodeURIComponent(redirect)}`,
        )
        return
      }
      if (mh.kind === 'handoff') {
        await navigateTo(
          { path: '/auth/verify', query: { handoff: mh.handoffCode, redirect } },
          { replace: true },
        )
        return
      }
      if (mh.kind === 'session') {
        if (canEditContent.value && mh.user.totpRequired && !mh.user.totpEnabled) {
          await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`)
          return
        }
        await navigateTo(redirect)
      }
      return
    }

    const result = await verify(token)
    if ('requiresTwoFactor' in result) {
      await navigateTo(
        `/auth/2fa?pending=${encodeURIComponent(result.pendingToken)}&redirect=${encodeURIComponent(redirect)}`,
      )
      return
    }
    if (canEditContent.value && result.totpRequired && !result.totpEnabled) {
      await navigateTo(`/auth/2fa/setup?redirect=${encodeURIComponent(redirect)}`)
      return
    }
    await navigateTo(redirect)
  } catch (err: unknown) {
    state.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'Something went wrong. Please request a new sign-in link.'
  }
}

async function copyHandoffUrl() {
  const code = handoffCodeForSafari.value
  if (!code || import.meta.server) return
  const path = `/auth/verify?handoff=${encodeURIComponent(code)}&redirect=${encodeURIComponent(safeRedirect(route.query.redirect, '/'))}`
  const url = `${window.location.origin}${path}`
  try {
    await navigator.clipboard.writeText(url)
    copyHint.value = strings.authVerifyHandoffCopied
  } catch {
    copyHint.value = url
  }
}

async function requestNewLink() {
  await startLoginFlow()
}

watch(
  () => route.fullPath,
  async () => {
    if (import.meta.server) return

    state.value = 'verifying'
    errorMessage.value = ''

    const redirect = safeRedirect(firstQueryString(route.query.redirect) || undefined, '/')
    const handoff = firstQueryString(route.query.handoff) || undefined
    const token = firstQueryString(route.query.token) || undefined

    if (handoff) {
      handoffCodeForSafari.value = handoff
      if (shouldDeferHandoffRedeem()) {
        state.value = 'handoff_wait'
        return
      }
      try {
        await redeemPwaHandoff(handoff)
        if (!user.value) throw new Error('Sign-in incomplete')
        await navigateAfterFullSession(redirect)
      } catch (e: any) {
        state.value = 'error'
        errorMessage.value = e?.message || 'Something went wrong. Please request a new sign-in link.'
      }
      return
    }

    if (!token) {
      state.value = 'error'
      errorMessage.value = 'No token found in the URL. Try clicking the link in your email again.'
      return
    }

    magicTokenForFlow.value = token

    if (isPwaPushLoginLink()) {
      state.value = 'pwa_push_prompt'
      return
    }

    await runNormalTokenVerify(token)
  },
  { immediate: true },
)
</script>
