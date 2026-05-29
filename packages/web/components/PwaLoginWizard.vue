<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-4 py-6"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pwa-login-title"
  >
    <div class="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-800 flex items-start justify-between gap-3">
        <div>
          <h2 id="pwa-login-title" class="text-lg font-semibold text-white">{{ strings.pwaLoginTitle }}</h2>
          <p class="text-gray-400 text-sm mt-1 leading-relaxed">{{ strings.pwaLoginIntro }}</p>
        </div>
        <button
          type="button"
          class="text-gray-500 hover:text-gray-300 text-sm shrink-0"
          aria-label="Close"
          @click="emit('dismiss')"
        >
          ✕
        </button>
      </div>

      <div class="px-5 py-3 text-xs text-gray-500">
        Step {{ step }} of 3
      </div>

      <!-- Step 1: email -->
      <div v-if="step === 1" class="px-5 pb-5 space-y-4">
        <label for="pwa-login-email" class="block text-sm font-medium text-gray-300">Email address</label>
        <input
          id="pwa-login-email"
          v-model="email"
          type="email"
          autocomplete="email"
          class="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
          :disabled="loading"
          @keydown.enter="goStep2"
        />
        <p v-if="errorMessage" class="text-xs text-red-400">{{ errorMessage }}</p>
        <button
          type="button"
          class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm"
          :disabled="loading || !email"
          @click="goStep2"
        >
          {{ loading ? 'Saving…' : 'Continue' }}
        </button>
      </div>

      <!-- Step 2: push permission -->
      <div v-else-if="step === 2" class="px-5 pb-5 space-y-4">
        <p v-if="pushAlreadyGranted" class="text-sm text-emerald-300/90 leading-relaxed">
          {{ strings.pwaLoginPushAlreadyGranted }}
        </p>
        <p v-else class="text-sm text-gray-300 leading-relaxed">{{ strings.pwaLoginPushStep }}</p>
        <p v-if="pushDenied" class="text-sm text-amber-300/90 leading-relaxed">{{ strings.pwaLoginPushDenied }}</p>
        <p v-if="errorMessage" class="text-xs text-red-400">{{ errorMessage }}</p>
        <button
          v-if="!pushDenied"
          type="button"
          class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm"
          :disabled="loading"
          @click="requestPushAndSubscribe"
        >
          {{ loading ? 'Working…' : (pushAlreadyGranted ? strings.pwaLoginResendEmail : 'Allow notifications') }}
        </button>
        <button
          v-if="pushAlreadyGranted"
          type="button"
          class="w-full py-2.5 border border-gray-600 text-gray-200 rounded-lg text-sm"
          :disabled="loading"
          @click="turnOffPushPermission"
        >
          {{ strings.pwaLoginTurnOffNotifications }}
        </button>
        <button
          v-else-if="pushDenied"
          type="button"
          class="w-full py-2.5 border border-gray-600 text-gray-200 rounded-lg text-sm"
          @click="emit('dismiss')"
        >
          Use regular sign-in instead
        </button>
      </div>

      <!-- Step 3: check email -->
      <div v-else class="px-5 pb-5 space-y-4">
        <p class="text-sm text-gray-300 leading-relaxed">{{ strings.pwaLoginCheckEmail }}</p>
        <p class="text-xs text-gray-500">{{ strings.pwaLoginCheckEmailHint }}</p>
        <button
          type="button"
          class="w-full py-2.5 border border-gray-600 text-gray-200 rounded-lg text-sm"
          @click="emit('dismiss')"
        >
          Done
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'
import { getOrCreatePwaDeviceToken, PWA_LOGIN_EMAIL_KEY } from '~/utils/pwa'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ dismiss: [] }>()

const { init, subscribeWithPushSubscription } = usePwaPushLogin()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string

const step = ref(1)
const email = ref('')
const loading = ref(false)
const errorMessage = ref('')
const pushDenied = ref(false)
const pushAlreadyGranted = ref(false)

async function detectPushAlreadyGranted() {
  if (!import.meta.client || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    pushAlreadyGranted.value = !!sub
  } catch {
    pushAlreadyGranted.value = Notification.permission === 'granted'
  }
}

async function turnOffPushPermission() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) await sub.unsubscribe()
    pushAlreadyGranted.value = false
    try { localStorage.removeItem(PWA_LOGIN_EMAIL_KEY) } catch { /* ignore */ }
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Could not turn off notifications'
  } finally {
    loading.value = false
  }
}

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from(rawData, c => c.charCodeAt(0))
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  return navigator.serviceWorker.ready
}

async function goStep2() {
  if (!email.value || loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    getOrCreatePwaDeviceToken()
    const normalized = email.value.trim().toLowerCase()
    await init(normalized)
    try { localStorage.setItem(PWA_LOGIN_EMAIL_KEY, normalized) } catch { /* ignore */ }
    await detectPushAlreadyGranted()
    step.value = 2
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Something went wrong'
  } finally {
    loading.value = false
  }
}

async function requestPushAndSubscribe() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  pushDenied.value = false

  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      pushDenied.value = true
      return
    }

    const vapidRes = await fetch(`${apiUrl}/api/push/vapid-public-key`)
    if (!vapidRes.ok) throw new Error('Push is not configured on the server')
    const { publicKey } = await vapidRes.json() as { publicKey: string }

    const reg = await getServiceWorkerRegistration()
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey).buffer as ArrayBuffer,
      })
    }

    const subJson = sub.toJSON()
    const { emailSent } = await subscribeWithPushSubscription({
      endpoint: subJson.endpoint!,
      keys: {
        p256dh: subJson.keys?.p256dh!,
        auth: subJson.keys?.auth!,
      },
    })
    if (!emailSent) {
      errorMessage.value = 'We could not send the sign-in email. Please try again.'
      return
    }
    step.value = 3
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Could not enable notifications'
  } finally {
    loading.value = false
  }
}

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    errorMessage.value = ''
    pushDenied.value = false
    pushAlreadyGranted.value = false
    try {
      const saved = localStorage.getItem(PWA_LOGIN_EMAIL_KEY)
      if (saved) email.value = saved
    } catch { /* ignore */ }
    if (email.value) {
      await detectPushAlreadyGranted()
      const permGranted = import.meta.client && 'Notification' in window && Notification.permission === 'granted'
      step.value = pushAlreadyGranted.value || permGranted ? 2 : 1
    } else {
      step.value = 1
    }
  }
})
</script>
