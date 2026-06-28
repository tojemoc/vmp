<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
    <div class="w-full max-w-sm">

      <!-- Logo / Brand -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center space-x-2 mb-4">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg"></div>
          <span class="text-xl font-bold text-white">{{ strings.siteNameShort }}</span>
        </div>
        <h1 class="text-2xl font-bold text-white">{{ strings.loginTitle }}</h1>
        <p class="text-gray-400 text-sm mt-1">{{ strings.loginSubtitle }}</p>
      </div>

      <!-- Form -->
      <div class="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div v-if="sent" class="rounded-lg bg-green-950 border border-green-800 px-4 py-3 text-sm text-green-300 leading-relaxed">
          {{ strings.loginMagicLinkSent }}
          <br><span class="text-green-500 text-xs">{{ strings.loginMagicLinkExpires }}</span>
          <p class="mt-2 text-[11px] text-green-400 leading-relaxed">
            {{ strings.loginSessionFlowHint }}
          </p>
          <p class="mt-3 text-[11px] text-green-400 leading-relaxed">
            {{ strings.loginOpenEmailHint }}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <a
              :href="nativeEmailInboxHref"
              class="font-medium text-green-200 underline underline-offset-2 hover:text-white"
            >
              {{ strings.loginOpenEmailApp }}
            </a>
            <span class="text-green-600" aria-hidden="true">·</span>
            <a
              :href="gmailInboxHref"
              target="_blank"
              rel="noopener noreferrer"
              class="text-green-300/90 underline underline-offset-2 hover:text-white"
            >
              {{ strings.loginOpenGmail }}
            </a>
            <span class="text-green-600" aria-hidden="true">·</span>
            <a
              :href="outlookInboxHref"
              target="_blank"
              rel="noopener noreferrer"
              class="text-green-300/90 underline underline-offset-2 hover:text-white"
            >
              {{ strings.loginOpenOutlook }}
            </a>
          </div>
        </div>

        <div v-else>
          <label for="email" class="block text-sm font-medium text-gray-300 mb-2">{{ strings.loginEmailLabel }}</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            :placeholder="strings.loginEmailPlaceholder"
            class="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            :disabled="loading"
            @keydown.enter="submit"
          />

          <div v-if="errorMessage" class="mt-2 text-xs text-red-400">{{ errorMessage }}</div>

          <button
            class="w-full mt-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
            :disabled="loading || !email"
            @click="submit"
          >
            {{ loading ? strings.loginSending : strings.loginSendLink }}
          </button>
        </div>
      </div>

      <p class="text-center text-xs text-gray-600 mt-6">
        {{ strings.loginTerms }}
      </p>

    </div>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'
import { getNativeEmailInboxHref } from '~/utils/emailInbox'
import { isIosInstalledPwa } from '~/utils/pwa'

usePageSeo({ title: strings.loginTitle, noIndex: true })

const route  = useRoute()
const { signIn, isLoggedIn } = useAuth()
const { waitForAuthInitialised } = useLoginFlow()
const { openPwaPushLoginWizard } = usePwaLoginWizardState()

const nativeEmailInboxHref = computed(() => getNativeEmailInboxHref(email.value))
const gmailInboxHref = 'https://mail.google.com/mail/u/0/#inbox'
const outlookInboxHref = 'https://outlook.live.com/mail/0/inbox'

function safeRedirect(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const t = value.trim()
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return fallback
  return t
}

const redirectTo = safeRedirect(route.query.redirect, '/')

if (isLoggedIn.value) {
  await navigateTo(redirectTo)
}

const email        = ref('')
const loading      = ref(false)
const sent         = ref(false)
const errorMessage = ref('')

onMounted(() => {
  void (async () => {
    await waitForAuthInitialised()
    const authenticated = isLoggedIn.value
    const iosPwa = isIosInstalledPwa()

    if (!authenticated && iosPwa) {
      openPwaPushLoginWizard()
    }
  })()
})

async function submit() {
  if (!email.value || loading.value) return
  loading.value  = true
  errorMessage.value = ''
  try {
    await signIn(email.value, redirectTo)
    sent.value = true
  } catch (err: any) {
    errorMessage.value = err.message || strings.loginErrorGeneric
  } finally {
    loading.value = false
  }
}
</script>
