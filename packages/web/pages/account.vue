<template>
  <div class="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-950">
    <AppHeader />

    <div class="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">

      <div
        v-if="showRelinkBanner"
        class="flex items-start gap-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4"
      >
        <div class="flex-1">
          <p class="font-semibold text-amber-900 dark:text-amber-200">{{ strings.accountRelinkBannerTitle }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-300 mt-0.5">
            {{ strings.accountRelinkBannerBody }}
          </p>
          <NuxtLink
            to="/pricing"
            class="inline-flex items-center mt-3 text-sm font-semibold text-amber-900 dark:text-amber-100 hover:underline"
          >
            {{ strings.accountRelinkBannerCta }}
          </NuxtLink>
        </div>
        <button
          type="button"
          class="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          @click="dismissRelinkBanner"
        >
          <span class="sr-only">{{ strings.dismiss }}</span>
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <div
        v-if="stripeCompletionError"
        class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 text-sm text-red-700 dark:text-red-300"
      >
        {{ stripeCompletionError }}
      </div>

      <!-- Welcome banner (shown after successful checkout redirect) -->
      <div
        v-if="showWelcomeBanner"
        class="flex items-start gap-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4"
      >
        <svg class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <div class="flex-1">
          <p class="font-semibold text-green-900 dark:text-green-200">{{ strings.subscribedWelcome }}</p>
          <p class="text-sm text-green-800 dark:text-green-300 mt-0.5">{{ strings.subscribedWelcomeDetail }}</p>
        </div>
        <button class="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200" @click="showWelcomeBanner = false">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <!-- Page heading -->
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ strings.yourAccount }}</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">{{ user?.email }}</p>
      </div>

      <!-- Loading skeleton -->
      <div v-if="loadingSub" class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <div class="h-5 w-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div class="h-4 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div class="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
      </div>

      <!-- Subscription -->
      <div
        v-else-if="!loadingSub"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6"
      >
        <template v-if="subscription?.status === 'needs_relink'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs text-amber-700 dark:text-amber-300 uppercase tracking-wide mb-1">{{ strings.accountSubscriptionLabel }}</p>
              <p class="text-lg font-semibold text-gray-900 dark:text-white">{{ strings.accountRelinkImportedTitle }}</p>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-2">
                {{ strings.accountRelinkImportedBody(legacyProviderDisplayName) }}
              </p>
            </div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
              {{ strings.accountRelinkStatusNeedsRelink }}
            </span>
          </div>
          <div class="mt-5 pt-5 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-3">
            <NuxtLink
              to="/pricing"
              class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white dark:text-white text-sm font-medium rounded-lg transition-colors"
            >
              {{ strings.accountRelinkPaymentMethod }}
            </NuxtLink>
            <a
              :href="supportMailto"
              class="inline-flex items-center px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white dark:text-white text-sm font-medium rounded-lg transition-colors"
            >
              {{ strings.accountContactSupport }}
            </a>
            <a
              v-if="showLegacyManageButton"
              :href="legacyManageUrl!"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
            >
              {{ strings.accountManagePaymentMethod }}
            </a>
          </div>
        </template>

        <template v-else-if="hasActiveSubscription && subscription">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{{ strings.currentPlan }}</p>
              <p class="text-lg font-semibold text-gray-900 dark:text-white capitalize">
                {{ strings.planDisplayName(subscription.planType) }}
              </p>
              <p v-if="subscription.provider" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ strings.providerLabel }}: {{ strings.paymentProviderLabel(subscription.provider) }}
              </p>
            </div>
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
              :class="statusBadgeClass(subscription.status)"
            >
              {{ subscription.status }}
            </span>
          </div>

          <div v-if="subscription.currentPeriodEnd" class="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <span v-if="subscription.status === 'active'">{{ strings.renewsOn }} </span>
            <span v-else>{{ strings.accessUntil }} </span>
            <span class="font-medium text-gray-900 dark:text-white">
              {{ formatDate(subscription.currentPeriodEnd) }}
            </span>
          </div>

          <div class="mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
            <button
              v-if="!(showLegacyManageButton && legacyManageUrl)"
              class="inline-flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              :disabled="openingPortal"
              @click="openPortal"
            >
              <span v-if="openingPortal">{{ strings.openingPortal }}</span>
              <span v-else>{{ strings.manageSubscription }}</span>
            </button>
            <a
              v-if="showLegacyManageButton && legacyManageUrl"
              :href="legacyManageUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="ml-3 inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
            >
              {{ strings.accountManagePaymentMethod }}
            </a>
            <p v-if="portalError" class="text-red-500 text-xs mt-2">{{ portalError }}</p>
          </div>
        </template>

        <template v-else>
          <SubscriptionCheckoutPanel
            return-path="/account"
            embedded
            :active="!hasActiveSubscription"
          />
        </template>
      </div>

      <!-- Podcast RSS -->
      <OfflineDownloadsPanel />

      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div>
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ strings.podcastRssTitle }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ strings.podcastRssIntro }}
          </p>
        </div>

        <div v-if="rssError" class="text-sm text-red-600 dark:text-red-400">
          {{ rssError }}
        </div>
        <div v-else-if="loadingRss" class="space-y-2">
          <div class="h-4 w-3/4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        </div>
        <template v-else>
          <div class="space-y-2">
            <p class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">{{ strings.podcastRssPersonalLabel }}</p>
            <div class="flex items-center gap-2">
              <input
                :value="rssPersonalUrl"
                readonly
                class="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
              <button
                class="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                @click="copyText(rssPersonalUrl, 'personal')"
              >
                {{ copiedWhich === 'personal' ? strings.copied : strings.copy }}
              </button>
            </div>
            <p v-if="copyError" class="text-xs text-red-600 dark:text-red-400">{{ copyError }}</p>
          </div>
        </template>
      </div>

      <!-- Security / 2FA card (staff roles required; viewers optional) -->
      <div
        v-if="show2faCard"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6"
      >
        <div class="flex items-center gap-3 mb-4">
          <div class="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ strings.totpAccountSectionTitle }}</h2>
        </div>

        <div v-if="user?.totpEnabled" class="space-y-4">
          <div class="flex flex-wrap items-center gap-3">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
              {{ strings.totpAccountEnabledBadge }}
            </span>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ strings.totpAccountEnabled }}</p>
          </div>

          <button
            type="button"
            class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
            :aria-expanded="showTotpDisable"
            aria-controls="totp-disable-panel"
            @click="showTotpDisable = !showTotpDisable"
          >
            {{ strings.totpAccountDisableButton }}
          </button>

          <div
            v-if="showTotpDisable"
            id="totp-disable-panel"
            class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
          >
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ user?.totpRequired ? strings.totpAccountDisableHintStaff : strings.totpAccountDisableHintOptional }}
            </p>
            <label for="totp-disable-code" class="block text-sm text-gray-700 dark:text-gray-300">
              {{ strings.totpAccountDisablePrompt }}
            </label>
            <div v-if="totpDisableError" class="text-sm text-red-600 dark:text-red-400">{{ totpDisableError }}</div>
            <input
              id="totp-disable-code"
              v-model="totpDisableCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              :placeholder="strings.totpCodePlaceholder"
              :disabled="totpDisabling"
              class="w-full max-w-xs px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-center text-lg tracking-widest font-mono"
            />
            <button
              type="button"
              class="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              :disabled="totpDisabling || totpDisableCode.length !== 6"
              @click="disableTotp"
            >
              {{ totpDisabling ? strings.totpAccountDisabling : strings.totpAccountDisableButton }}
            </button>
          </div>
        </div>

        <div v-else-if="user?.totpRequired">
          <div class="flex items-center gap-3 mb-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
              {{ strings.totpAccountSetupRequiredBadge }}
            </span>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ strings.totpAccountSetupRequired }}</p>
          </div>
          <NuxtLink
            to="/auth/2fa/setup?redirect=/account"
            class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {{ strings.totpAccountSetupButton }}
          </NuxtLink>
        </div>

        <div v-else>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {{ strings.totpAccountOptionalBlurb }}
          </p>
          <NuxtLink
            to="/auth/2fa/setup?redirect=/account"
            class="inline-flex items-center px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
          >
            {{ strings.totpAccountSetupButton }}
          </NuxtLink>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'

usePageSeo({ title: strings.yourAccount, noIndex: true })

const route  = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string

const ROLES_REQUIRING_2FA = ['editor', 'analyst', 'moderator', 'admin', 'super_admin'] as const

const { user, subscription, fetchSubscription, authHeader, isLoggedIn, markTotpDisabled, applyNewSession } = useAuth()
const { siteSettings } = useSiteSettings()
const { startLoginFlow, waitForAuthInitialised } = useLoginFlow()

const hasActiveSubscription = computed(() => {
  const sub = subscription.value
  if (!sub) return false
  return sub.status === 'active' || sub.status === 'trialing' || sub.status === 'needs_relink'
})

const legacyManageUrl = computed(() => {
  const sub = subscription.value as { legacyManageUrl?: string | null } | null
  const url = sub?.legacyManageUrl
  return typeof url === 'string' && url.trim() ? url.trim() : null
})

const showLegacyManageButton = computed(() => {
  const sub = subscription.value as { showLegacyManageButton?: boolean; provider?: string; status?: string } | null
  if (!sub || sub.provider !== 'legacy') return false
  if (sub.showLegacyManageButton === false) return false
  return Boolean(legacyManageUrl.value) && ['active', 'needs_relink', 'past_due'].includes(sub.status ?? '')
})

const legacyProviderDisplayName = computed(() => {
  const sub = subscription.value
  if (sub?.provider === 'legacy') return strings.paymentProviderLabel('legacy')
  return strings.accountRelinkLegacyProviderFallback
})

const supportMailto = computed(() => {
  const email = siteSettings.value.supportEmail?.trim() || 'vmp@tjm.sk'
  return `mailto:${email}`
})

const relinkBannerDismissed = ref(false)

const showRelinkBanner = computed(() => {
  if (relinkBannerDismissed.value) return false
  if (route.query.relink !== '1') return false
  const sub = subscription.value
  if (!sub) return false
  return sub.provider === 'legacy' && (sub.status === 'needs_relink' || sub.status === 'cancelled' || sub.status === 'past_due')
})

function relinkBannerStorageKey(userId: string | undefined): string {
  return `vmp_relink_banner_dismissed:${userId ?? 'anonymous'}`
}

function dismissRelinkBanner() {
  relinkBannerDismissed.value = true
  if (import.meta.client) {
    sessionStorage.setItem(relinkBannerStorageKey(user.value?.id), '1')
  }
}

const roleRequires2fa = computed(() => {
  const role = user.value?.role
  return !!role && (ROLES_REQUIRING_2FA as readonly string[]).includes(role)
})

const show2faCard = computed(() => {
  if (!user.value) return false
  if (user.value.totpEnabled || user.value.totpRequired) return true
  return roleRequires2fa.value || user.value.role === 'viewer'
})

// Guard: redirect to login if not authenticated (client only — refresh cookie is browser-only).
if (import.meta.client) {
  await waitForAuthInitialised()
  if (!isLoggedIn.value) {
    await startLoginFlow(route.fullPath)
  }
}

const loadingSub        = ref(true)
const openingPortal     = ref(false)
const portalError       = ref<string | null>(null)
const showWelcomeBanner = ref(route.query.subscribed === '1')

const {
  returningFromStripe,
  completeStripeCheckoutReturn,
  clearStripeSessionQuery,
} = useStripeCheckoutReturn()
const stripeCompletionError = ref<string | null>(null)

const showTotpDisable   = ref(false)
const totpDisableCode   = ref('')
const totpDisabling     = ref(false)
const totpDisableError  = ref<string | null>(null)

async function disableTotp() {
  if (totpDisableCode.value.length !== 6 || totpDisabling.value) return
  totpDisabling.value = true
  totpDisableError.value = null
  try {
    const res = await fetch(`${apiUrl}/api/auth/2fa/disable`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json', ...authHeader() },
      body:        JSON.stringify({ code: totpDisableCode.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || strings.totpAccountDisableFailed)
    if (data.accessToken && data.user) {
      applyNewSession(data.accessToken, data.user)
    } else if (data.user) {
      markTotpDisabled(data.user)
    } else {
      markTotpDisabled()
    }
    showTotpDisable.value = false
    totpDisableCode.value = ''
  } catch (e: unknown) {
    totpDisableError.value = e instanceof Error ? e.message : strings.totpAccountDisableFailed
  } finally {
    totpDisabling.value = false
  }
}
const loadingRss        = ref(true)
const rssError          = ref<string | null>(null)
const copyError         = ref<string | null>(null)
const rssPersonalUrl    = ref('')
const copiedWhich       = ref<'personal' | null>(null)

onMounted(async () => {
  if (import.meta.client && sessionStorage.getItem(relinkBannerStorageKey(user.value?.id)) === '1') {
    relinkBannerDismissed.value = true
  }

  if (returningFromStripe.value) {
    const result = await completeStripeCheckoutReturn()
    if (result.ok || result.pending) {
      showWelcomeBanner.value = true
      await clearStripeSessionQuery({ subscribed: '1' })
    } else {
      stripeCompletionError.value = result.error ?? strings.checkoutStartFailed
    }
  }

  if (showWelcomeBanner.value || returningFromStripe.value) {
    // After checkout redirect the webhook may not have fired yet.
    // Poll up to 5 times (at 2 s intervals) until we see an active subscription.
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await fetchSubscription()
      if (subscription.value?.status === 'active' || subscription.value?.status === 'trialing') break
      if (attempt < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, 2000))
    }
  } else {
    await fetchSubscription()
  }
  loadingSub.value = false

  await fetchRssUrls()
})

watch(subscription, (sub) => {
  if (sub && sub.provider !== 'legacy') {
    relinkBannerDismissed.value = true
  }
})

function statusBadgeClass(status: string): string {
  if (status === 'active' || status === 'trialing') {
    return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
  }
  if (status === 'past_due') {
    return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
  }
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

async function openPortal() {
  openingPortal.value = true
  portalError.value = null
  try {
    const res = await fetch(`${apiUrl}/api/payments/portal`, {
      method:      'POST',
      credentials: 'include',
      headers:     authHeader(),
    })
    const data = await res.json()
    if (!res.ok || !data.portalUrl) {
      portalError.value = data.error ?? strings.billingPortalFailed
      return
    }
    window.location.href = data.portalUrl
  } catch {
    portalError.value = strings.networkError
  } finally {
    openingPortal.value = false
  }
}

async function fetchRssUrls() {
  loadingRss.value = true
  rssError.value = null
  try {
    const res = await fetch(`${apiUrl}/api/account/rss`, {
      headers: authHeader(),
      credentials: 'include',
    })
    const data = await res.json()
    if (!res.ok) {
      rssError.value = data.error ?? strings.rssLoadFailed
      return
    }
    rssPersonalUrl.value = data.personalUrl ?? ''
  } catch {
    rssError.value = strings.rssLoadNetworkError
  } finally {
    loadingRss.value = false
  }
}

async function copyText(value: string, which: 'personal') {
  if (!value) return
  copyError.value = null
  try {
    await navigator.clipboard.writeText(value)
    copiedWhich.value = which
    setTimeout(() => {
      if (copiedWhich.value === which) copiedWhich.value = null
    }, 1200)
  } catch {
    copyError.value = strings.copyFailed
  }
}
</script>
