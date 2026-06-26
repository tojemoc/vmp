<template>
  <div class="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-950">
    <AppHeader />

    <div class="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ pageTitle }}</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">{{ pageSubtitle }}</p>
      </div>

      <div
        v-if="legacyCompletionError"
        class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 text-sm text-red-700 dark:text-red-300"
      >
        {{ legacyCompletionError }}
      </div>

      <div
        v-if="showWelcomeBanner"
        class="flex items-start gap-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4"
      >
        <div class="flex-1">
          <p class="font-semibold text-green-900 dark:text-green-200">{{ strings.subscribedWelcome }}</p>
          <p class="text-sm text-green-800 dark:text-green-300 mt-0.5">{{ strings.subscribedWelcomeDetail }}</p>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <LegacyRelinkCheckout
          v-if="showRelinkFlow"
          return-path="/pricing"
          force-legacy
          :description="strings.accountRelinkImportedBody(legacyProviderDisplayName)"
        />
        <SubscriptionCheckoutPanel
          v-else
          return-path="/pricing"
          embedded
          active
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'

usePageSeo({ title: strings.checkoutPremiumTitle, noIndex: true })

const route = useRoute()
const { subscription, fetchSubscription, isLoggedIn } = useAuth()
const { waitForAuthInitialised, startLoginFlow } = useLoginFlow()
const {
  returningFromLegacy,
  completeLegacyCheckoutReturn,
  clearLegacyOrderQuery,
} = useLegacyCheckoutReturn()

const legacyCompletionError = ref<string | null>(null)
const showWelcomeBanner = ref(false)

const showRelinkFlow = computed(() => {
  const sub = subscription.value
  return sub?.provider === 'legacy' && sub.status === 'needs_relink'
})

const legacyProviderDisplayName = computed(() => {
  const sub = subscription.value
  const name = sub?.legacyProviderName?.trim()
  if (name) return name
  if (sub?.provider === 'legacy') return strings.paymentProviderLabel('legacy')
  return strings.accountRelinkLegacyProviderFallback
})

const pageTitle = computed(() =>
  showRelinkFlow.value ? strings.accountRelinkImportedTitle : strings.checkoutPremiumTitle,
)

const pageSubtitle = computed(() =>
  showRelinkFlow.value
    ? strings.accountRelinkBannerBody
    : strings.checkoutPremiumSubtitle,
)

if (import.meta.client) {
  await waitForAuthInitialised()
  if (!isLoggedIn.value) {
    await startLoginFlow(route.fullPath)
  }
}

onMounted(async () => {
  if (returningFromLegacy.value) {
    const result = await completeLegacyCheckoutReturn()
    if (result.ok || result.pending) {
      showWelcomeBanner.value = true
      await clearLegacyOrderQuery({ subscribed: '1' })
      await fetchSubscription()
    } else {
      legacyCompletionError.value = result.error ?? strings.checkoutStartFailed
    }
    return
  }

  await fetchSubscription()
})
</script>
