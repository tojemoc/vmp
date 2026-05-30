<!-- packages/web/pages/auth/2fa/setup.vue -->
<!--
  TOTP setup page (first-time or after disabling 2FA).
  URL: /auth/2fa/setup?redirect=...

  Flow:
  1. Page loads → calls GET /api/auth/2fa/setup to get a fresh secret + otpauth URI
  2. Renders QR code for the user to scan with their authenticator app
  3. User enters the 6-digit code and submits
  4. POST /api/auth/2fa/confirm — if valid, 2FA is enabled and user is redirected
-->
<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">

      <!-- Header -->
      <div class="text-center mb-8">
        <div class="w-14 h-14 mx-auto rounded-full bg-blue-950 border border-blue-800 flex items-center justify-center mb-4">
          <svg class="w-7 h-7 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h1 class="text-xl font-semibold text-white">{{ strings.totpSetupTitle }}</h1>
        <p class="text-gray-400 text-sm mt-2 leading-relaxed">
          {{ setupIntro }}
        </p>
      </div>

      <!-- Loading -->
      <div v-if="state === 'loading'" class="text-center py-12 space-y-3">
        <div class="inline-block w-8 h-8 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin"></div>
        <p class="text-gray-500 text-sm">Generating your secret…</p>
      </div>

      <!-- Error loading setup -->
      <div v-else-if="state === 'loadError'" class="text-center space-y-4">
        <div class="px-4 py-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
          {{ loadError }}
        </div>
        <button
          v-if="loadErrorCode !== 'totp_already_enabled'"
          type="button"
          class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
          @click="loadSetup"
        >
          Try again
        </button>
        <NuxtLink
          v-else
          to="/account"
          class="inline-block px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
        >
          Back to account
        </NuxtLink>
      </div>

      <!-- Setup form -->
      <div v-else-if="state === 'setup'" class="space-y-6">

        <!-- QR code -->
        <div class="bg-gray-900 rounded-xl border border-gray-800 p-6 flex flex-col items-center gap-4">
          <canvas ref="qrCanvas" class="rounded-lg"></canvas>
          <p class="text-xs text-gray-500 text-center">
            {{ strings.totpSetupManualEntry }}
          </p>
          <div class="bg-gray-800 rounded-lg px-4 py-2 font-mono text-sm text-gray-300 tracking-widest select-all text-center break-all">
            {{ formattedSecret }}
          </div>
        </div>

        <!-- Confirm form -->
        <form @submit.prevent="confirm" class="space-y-4">
          <div v-if="confirmError" class="px-4 py-3 rounded-lg bg-red-950 border border-red-800 text-red-400 text-sm">
            {{ confirmError }}
          </div>

          <div>
            <label for="confirmCode" class="block text-sm font-medium text-gray-300 mb-1.5">
              {{ strings.totpSetupConfirmLabel }}
            </label>
            <input
              id="confirmCode"
              v-model="confirmCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="000000"
              :disabled="confirming"
              class="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            :disabled="confirming || confirmCode.length !== 6"
            class="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
          >
            <span v-if="confirming" class="inline-flex items-center gap-2">
              <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block"></span>
              {{ strings.totpSetupConfirming }}
            </span>
            <span v-else>{{ strings.totpSetupEnableButton }}</span>
          </button>
        </form>

      </div>

      <!-- Success -->
      <div v-else-if="state === 'done'" class="text-center space-y-6">
        <div class="w-14 h-14 mx-auto rounded-full bg-green-950 border border-green-800 flex items-center justify-center">
          <svg class="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-white mb-1">{{ strings.totpSetupEnabledTitle }}</h2>
          <p class="text-gray-400 text-sm">{{ strings.totpSetupEnabledBody }}</p>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { navigateTo, useRoute } from '#app'
import QRCode from 'qrcode'
import strings from '~/utils/strings'

// Do NOT use the admin middleware here — it would cause a redirect loop
// because it redirects to this page when totpEnabled is false.
const { user, isLoggedIn, authHeader, markTotpEnabled, applyNewSession } = useAuth()
const { startLoginFlow } = useLoginFlow()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string
const route  = useRoute()

function safeRedirect(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const t = value.trim()
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return fallback
  return t
}

const postSetupRedirect = computed(() =>
  safeRedirect(route.query.redirect, '/account')
)

const blockedAtAdminGate = computed(() => {
  const target = postSetupRedirect.value
  return target === '/admin' || target.startsWith('/admin/')
})

const setupIntro = computed(() => {
  if (user.value?.totpRequired) {
    return blockedAtAdminGate.value
      ? strings.totpSetupIntroAdminGate
      : strings.totpSetupIntroStaffRequired
  }
  return strings.totpSetupIntroOptional
})

type State = 'loading' | 'loadError' | 'setup' | 'done'
const state        = ref<State>('loading')
const loadError    = ref('')
const loadErrorCode = ref('')
const secret       = ref('')
const otpAuthUrl   = ref('')
const confirmCode  = ref('')
const confirmError = ref('')
const confirming   = ref(false)
const qrCanvas      = ref<HTMLCanvasElement | null>(null)
let   redirectTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => { if (redirectTimer) clearTimeout(redirectTimer) })

const formattedSecret = computed(() =>
  secret.value.replace(/(.{4})/g, '$1 ').trim()
)

async function loadSetup() {
  state.value     = 'loading'
  loadError.value = ''
  loadErrorCode.value = ''

  try {
    const res  = await fetch(`${apiUrl}/api/auth/2fa/setup`, { headers: authHeader() })
    const data = await res.json()

    if (res.status === 401) {
      const inner = safeRedirect(route.query.redirect, '')
      const setupPath = '/auth/2fa/setup' + (inner ? `?redirect=${encodeURIComponent(inner)}` : '')
      await startLoginFlow(setupPath)
      return
    }

    if (res.status === 409 && data.code === 'totp_already_enabled') {
      loadError.value = strings.totpSetupAlreadyEnabled
      loadErrorCode.value = 'totp_already_enabled'
      state.value = 'loadError'
      return
    }

    if (!res.ok) throw new Error(data.error || 'Failed to load setup')

    secret.value     = data.secret
    otpAuthUrl.value = data.otpAuthUrl
    state.value      = 'setup'

    await nextTick()
    if (qrCanvas.value) {
      await QRCode.toCanvas(qrCanvas.value, data.otpAuthUrl, {
        width:  220,
        margin: 2,
        color:  { dark: '#000000', light: '#ffffff' },
      })
    }
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load setup. Please refresh.'
    state.value     = 'loadError'
  }
}

async function confirm() {
  if (confirmCode.value.length !== 6 || confirming.value) return

  confirming.value   = true
  confirmError.value = ''

  try {
    const res = await fetch(`${apiUrl}/api/auth/2fa/confirm`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json', ...authHeader() },
      body:        JSON.stringify({ secret: secret.value, code: confirmCode.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Confirmation failed')

    if (data.accessToken && data.user) {
      applyNewSession(data.accessToken, data.user)
    } else {
      markTotpEnabled()
    }
    state.value = 'done'

    redirectTimer = setTimeout(() => navigateTo(postSetupRedirect.value), 1500)
  } catch (err: any) {
    confirmError.value = err.message || 'Invalid code. Please try again.'
    confirmCode.value  = ''
  } finally {
    confirming.value = false
  }
}

onMounted(async () => {
  if (!isLoggedIn.value) {
    const inner = safeRedirect(route.query.redirect, '')
    const setupPath = '/auth/2fa/setup' + (inner ? `?redirect=${encodeURIComponent(inner)}` : '')
    await startLoginFlow(setupPath)
    return
  }
  await loadSetup()
})
</script>
