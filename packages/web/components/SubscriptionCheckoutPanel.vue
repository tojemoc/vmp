<template>
  <div :class="embedded ? 'text-left' : 'text-center'">
    <div
      class="w-16 h-16 mb-4 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center"
      :class="embedded ? '' : 'mx-auto'"
    >
      <svg class="w-8 h-8 text-gray-900" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
      </svg>
    </div>

    <h3
      class="text-2xl font-bold mb-2"
      :class="embedded ? 'text-gray-900 dark:text-white' : 'text-white'"
    >
      {{ strings.checkoutPremiumTitle }}
    </h3>
    <p
      class="mb-6"
      :class="embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400'"
    >
      {{ strings.checkoutPremiumSubtitle }}
    </p>

    <div v-if="loadingPrices" class="flex gap-3 mb-6">
      <div
        v-for="i in 3"
        :key="i"
        class="flex-1 h-28 rounded-lg animate-pulse"
        :class="embedded ? 'bg-gray-200 dark:bg-gray-800' : 'bg-gray-800'"
      />
    </div>

    <div v-else-if="!priceError" class="flex flex-col sm:flex-row gap-3 mb-6">
      <button
        type="button"
        class="flex-1 relative rounded-lg border-2 p-4 text-left transition-all cursor-pointer"
        :class="planButtonClass('monthly')"
        @click="selectedPlan = 'monthly'"
      >
        <div
          class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
        >
          {{ strings.checkoutMostPopular }}
        </div>
        <p class="text-xs uppercase tracking-wide mb-1" :class="planLabelClass">{{ strings.checkoutPlanMonthly }}</p>
        <p class="text-xl font-bold" :class="planPriceClass">{{ formatPrice(primaryPlanPrice('monthly')) }}</p>
        <p class="text-xs mt-0.5" :class="planSubtextClass">{{ strings.checkoutPerMonth }}</p>
      </button>

      <button
        type="button"
        class="flex-1 rounded-lg border-2 p-4 text-left transition-all cursor-pointer"
        :class="planButtonClass('yearly')"
        @click="selectedPlan = 'yearly'"
      >
        <p class="text-xs uppercase tracking-wide mb-1" :class="planLabelClass">{{ strings.checkoutPlanYearly }}</p>
        <p class="text-xl font-bold" :class="planPriceClass">{{ formatPrice(primaryPlanPrice('yearly')) }}</p>
        <p class="text-xs mt-0.5" :class="planSubtextClass">{{ strings.checkoutPerYear }}</p>
      </button>

      <button
        type="button"
        class="flex-1 rounded-lg border-2 p-4 text-left transition-all cursor-pointer"
        :class="planButtonClass('club')"
        @click="selectedPlan = 'club'"
      >
        <p class="text-xs uppercase tracking-wide mb-1" :class="planLabelClass">{{ strings.checkoutPlanClub }}</p>
        <p class="text-xl font-bold" :class="planPriceClass">{{ formatPrice(primaryPlanPrice('club')) }}</p>
        <p class="text-xs mt-0.5" :class="planSubtextClass">{{ strings.checkoutPerYear }}</p>
      </button>
    </div>

    <div v-if="priceError" class="text-red-400 text-sm mb-6">
      {{ strings.checkoutPricesLoadFailed }}
    </div>

    <div
      v-if="!loadingPrices && !priceError && showPaymentTabs"
      class="flex rounded-lg p-1 mb-4"
      :class="embedded ? 'bg-gray-100 dark:bg-gray-800' : 'bg-gray-800'"
      role="tablist"
      :aria-label="strings.checkoutPaymentMethodTabs"
    >
      <button
        v-for="tab in visiblePaymentTabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors"
        :class="paymentTabClass(tab.id)"
        :aria-selected="activePaymentTab === tab.id"
        @click="activePaymentTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="checkoutError" class="text-red-400 text-sm mb-3">
      {{ checkoutError }}
    </div>

    <div class="mb-3 text-left">
      <label class="text-xs uppercase tracking-wide block mb-1" :class="embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500'">
        {{ strings.checkoutPromoLabel }}
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="promoCodeInput"
          type="text"
          autocomplete="off"
          :placeholder="strings.checkoutPromoPlaceholder"
          class="flex-1 min-w-[10rem] px-3 py-2 rounded-lg border text-sm placeholder-gray-500"
          :class="embedded
            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white'
            : 'border-gray-700 bg-gray-800 text-white'"
        >
        <button
          type="button"
          class="px-3 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
          :class="embedded ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-700 hover:bg-gray-600'"
          :disabled="promoValidating || !promoCodeInput.trim()"
          @click="validatePromoCode"
        >
          {{ promoValidating ? strings.checkoutPromoChecking : strings.checkoutPromoApply }}
        </button>
        <button
          v-if="promoApplied"
          type="button"
          class="px-3 py-2 text-sm font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-white"
          @click="clearPromoCode"
        >
          {{ strings.checkoutPromoClear }}
        </button>
      </div>
      <p v-if="promoError" class="text-xs text-red-400 mt-1">{{ promoError }}</p>
      <p v-else-if="promoApplied" class="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
        {{ strings.checkoutPromoApplied(promoApplied.code, promoApplied.rewardType.replace('_', ' ')) }}
      </p>
    </div>

    <div v-if="!loadingPrices && !priceError && stripeCheckoutActive" class="mb-4">
      <StripeEmbeddedCheckout
        :plan-type="selectedPlan"
        :promo-code="promoApplied?.code ?? ''"
        :return-path="returnPath"
        :embedded="embedded"
        :active-tab="activeStripeTab"
        :card-pay-label="strings.checkoutPayWithCard(formatPrice(providerPlanPrice('stripe', selectedPlan)))"
        @wallet-available="onWalletAvailable"
      />
    </div>

    <div v-else-if="!loadingPrices && !priceError && activePaymentTab === 'bank'" class="space-y-2">
      <button
        type="button"
        class="w-full text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700"
        :disabled="checkingOut || !providerPlanPrice('gocardless', selectedPlan)"
        @click="handleSubscribe('gocardless')"
      >
        <span v-if="checkingOut">{{ strings.checkoutRedirecting }}</span>
        <span v-else>{{ strings.checkoutPayWithBank(formatPrice(providerPlanPrice('gocardless', selectedPlan))) }}</span>
      </button>
    </div>

    <p class="text-xs mt-3" :class="embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500'">
      {{ checkoutBlurb }}
    </p>
    <p
      v-if="!isLoggedIn"
      class="text-sm mt-2"
      :class="embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400'"
    >
      {{ strings.checkoutSignInBefore }}
      <button type="button" class="text-blue-500 dark:text-blue-400 hover:underline" @click="goToLogin">
        {{ strings.signIn }}
      </button>
    </p>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'

const props = withDefaults(defineProps<{
  /** Base path for post-login return (e.g. `/account` or `/watch/abc`). */
  returnPath: string
  /** When true, append `showPremium=1` to login redirect (watch page). */
  reopenPremiumOnReturn?: boolean
  /** Load pricing immediately (account page). When false, parent controls via `active`. */
  active?: boolean
  /** Use account-page styling instead of dark modal styling. */
  embedded?: boolean
}>(), {
  reopenPremiumOnReturn: false,
  active: true,
  embedded: false,
})

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string
const route = useRoute()
const { isLoggedIn, authHeader } = useAuth()
const { startLoginFlow } = useLoginFlow()

type PlanType = 'monthly' | 'yearly' | 'club'
type PaymentProvider = 'stripe' | 'gocardless'
type PaymentTab = 'wallet' | 'card' | 'bank'

interface Prices { monthly: number; yearly: number; club: number }
interface ProviderPriceMap { stripe: Prices; gocardless: Prices }

const defaultPrices: Prices = { monthly: 6.90, yearly: 74.90, club: 109.00 }
const pricesByProvider = ref<ProviderPriceMap>({
  stripe: { ...defaultPrices },
  gocardless: { ...defaultPrices },
})
const loadingPrices = ref(false)
const priceError = ref(false)
const selectedPlan = ref<PlanType>('monthly')
const availableProviders = ref<PaymentProvider[]>(['stripe'])
const selectedProvider = ref<PaymentProvider>('stripe')
const activePaymentTab = ref<PaymentTab>('card')
const walletTabAvailable = ref(false)
const checkingOut = ref(false)
const checkoutError = ref<string | null>(null)
const promoCodeInput = ref('')
const promoValidating = ref(false)
const promoError = ref<string | null>(null)
const promoApplied = ref<null | { code: string; rewardType: string }>(null)
/** Bumped on each validatePromoCode() so in-flight responses cannot overwrite newer state. */
let promoValidationGeneration = 0

const planLabelClass = computed(() =>
  props.embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400',
)
const planPriceClass = computed(() =>
  props.embedded ? 'text-gray-900 dark:text-white' : 'text-white',
)
const planSubtextClass = computed(() =>
  props.embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500',
)

const stripeEnabled = computed(() => availableProviders.value.includes('stripe'))
const gocardlessEnabled = computed(() => availableProviders.value.includes('gocardless'))
const showPaymentTabs = computed(() => stripeEnabled.value || gocardlessEnabled.value)

const visiblePaymentTabs = computed(() => {
  const tabs: { id: PaymentTab; label: string }[] = []
  if (stripeEnabled.value) {
    if (walletTabAvailable.value) {
      tabs.push({ id: 'wallet', label: strings.checkoutTabWallet })
    }
    tabs.push({ id: 'card', label: strings.checkoutTabCard })
  }
  if (gocardlessEnabled.value) {
    tabs.push({ id: 'bank', label: strings.checkoutTabBank })
  }
  return tabs
})

const stripeCheckoutActive = computed(() =>
  stripeEnabled.value && (activePaymentTab.value === 'wallet' || activePaymentTab.value === 'card'),
)

const activeStripeTab = computed<'wallet' | 'card'>(() =>
  activePaymentTab.value === 'wallet' ? 'wallet' : 'card',
)

function paymentTabClass(tab: PaymentTab): string {
  const selected = activePaymentTab.value === tab
  if (props.embedded) {
    return selected
      ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
  }
  return selected
    ? 'bg-gray-700 text-white'
    : 'text-gray-400 hover:text-white'
}

function onWalletAvailable(available: boolean) {
  walletTabAvailable.value = available
  if (available && activePaymentTab.value === 'card') {
    activePaymentTab.value = 'wallet'
  }
  if (!available && activePaymentTab.value === 'wallet') {
    activePaymentTab.value = 'card'
  }
}

watch(visiblePaymentTabs, (tabs) => {
  if (!tabs.some((t) => t.id === activePaymentTab.value)) {
    activePaymentTab.value = tabs[0]?.id ?? 'card'
  }
}, { immediate: true })

function planButtonClass(plan: PlanType): string {
  const selected = selectedPlan.value === plan
  if (props.embedded) {
    return selected
      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500'
  }
  return selected
    ? 'border-blue-500 bg-blue-500/10'
    : 'border-gray-700 bg-gray-800 hover:border-gray-500'
}

function formatPrice(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '…'
  return `€${amount.toFixed(2)}`
}

function providerPlanPrice(provider: PaymentProvider, plan: PlanType): number | null {
  const value = pricesByProvider.value[provider]?.[plan]
  return Number.isFinite(value) ? Number(value) : null
}

function primaryPlanPrice(plan: PlanType): number | null {
  const first = availableProviders.value[0] ?? 'stripe'
  return providerPlanPrice(first, plan)
}

function promoProviderForTab(): PaymentProvider {
  return activePaymentTab.value === 'bank' ? 'gocardless' : 'stripe'
}

const checkoutBlurb = computed(() => {
  if (stripeEnabled.value && gocardlessEnabled.value) {
    return strings.checkoutBlurbBoth
  }
  if (gocardlessEnabled.value) {
    return strings.checkoutBlurbGoCardless
  }
  if (stripeEnabled.value) {
    return strings.checkoutBlurbEmbedded
  }
  return strings.checkoutBlurbDefault
})

function buildLoginRedirect(plan: PlanType, provider: PaymentProvider): string {
  const params = new URLSearchParams()
  if (props.reopenPremiumOnReturn) params.set('showPremium', '1')
  params.set('checkout_plan', plan)
  params.set('checkout_provider', provider)
  const joiner = props.returnPath.includes('?') ? '&' : '?'
  return `${props.returnPath}${joiner}${params.toString()}`
}

async function loadPrices() {
  loadingPrices.value = true
  priceError.value = false
  try {
    const res = await fetch(`${apiUrl}/api/account/pricing`)
    if (!res.ok) {
      priceError.value = true
      return
    }

    const data = await res.json()
    const providers = Array.isArray(data.enabledProviders)
      ? data.enabledProviders.filter((p: string) => p === 'stripe' || p === 'gocardless')
      : []
    availableProviders.value = providers.length ? providers : ['stripe']

    const fallback: Prices = {
      monthly: Number(data.monthly ?? defaultPrices.monthly),
      yearly: Number(data.yearly ?? defaultPrices.yearly),
      club: Number(data.club ?? defaultPrices.club),
    }

    const stripeRaw = data?.pricesByProvider?.stripe ?? {}
    const gocardlessRaw = data?.pricesByProvider?.gocardless ?? {}

    pricesByProvider.value = {
      stripe: {
        monthly: Number(stripeRaw.monthly ?? fallback.monthly),
        yearly: Number(stripeRaw.yearly ?? fallback.yearly),
        club: Number(stripeRaw.club ?? fallback.club),
      },
      gocardless: {
        monthly: Number(gocardlessRaw.monthly ?? fallback.monthly),
        yearly: Number(gocardlessRaw.yearly ?? fallback.yearly),
        club: Number(gocardlessRaw.club ?? fallback.club),
      },
    }

    if (!availableProviders.value.includes(selectedProvider.value)) {
      selectedProvider.value = availableProviders.value[0] ?? 'stripe'
    }

    const hasVisiblePrice = availableProviders.value.some((provider) => providerPlanPrice(provider, selectedPlan.value) != null)
    if (!hasVisiblePrice) {
      priceError.value = true
    }
  } catch {
    priceError.value = true
  } finally {
    loadingPrices.value = false
  }
}

async function handleSubscribe(provider: PaymentProvider) {
  if (!isLoggedIn.value) {
    await startLoginFlow(buildLoginRedirect(selectedPlan.value, provider))
    return
  }

  if (provider !== 'gocardless') return

  selectedProvider.value = provider
  checkingOut.value = true
  checkoutError.value = null
  const promoCode = promoApplied.value?.code || ''
  try {
    const res = await fetch(`${apiUrl}/api/payments/checkout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        planType: selectedPlan.value,
        provider,
        promoCode,
        returnPath: props.returnPath,
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.checkoutUrl) {
      checkoutError.value = data.error ?? strings.checkoutStartFailed
      return
    }
    window.location.href = data.checkoutUrl
  } catch {
    checkoutError.value = strings.networkError
  } finally {
    checkingOut.value = false
  }
}

async function goToLogin() {
  await startLoginFlow(props.returnPath)
}

function isStalePromoValidation(
  generation: number,
  providerAtRequest: PaymentProvider,
  planAtRequest: PlanType,
  codeAtRequest: string,
): boolean {
  if (generation !== promoValidationGeneration) return true
  if (promoProviderForTab() !== providerAtRequest) return true
  if (selectedPlan.value !== planAtRequest) return true
  if (promoCodeInput.value.trim().toUpperCase() !== codeAtRequest) return true
  return false
}

async function validatePromoCode() {
  promoError.value = null
  promoApplied.value = null
  const code = promoCodeInput.value.trim().toUpperCase()
  promoCodeInput.value = code
  if (!code) return

  if (!isLoggedIn.value) {
    promoError.value = strings.checkoutPromoSignIn
    return
  }

  const generation = ++promoValidationGeneration
  const providerAtRequest = promoProviderForTab()
  const planAtRequest = selectedPlan.value

  promoValidating.value = true
  try {
    const res = await fetch(`${apiUrl}/api/account/promotions/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ promoCode: code, planType: planAtRequest, provider: providerAtRequest }),
    })
    const data = await res.json().catch(() => ({}))
    if (isStalePromoValidation(generation, providerAtRequest, planAtRequest, code)) return
    if (!res.ok || !data?.valid) {
      promoError.value = data?.error || strings.checkoutPromoInvalid
      return
    }
    promoApplied.value = {
      code: String(data?.promo?.code || code),
      rewardType: String(data?.promo?.rewardType || 'free_month'),
    }
  } catch {
    if (isStalePromoValidation(generation, providerAtRequest, planAtRequest, code)) return
    promoError.value = strings.checkoutPromoValidateNetworkError
  } finally {
    if (generation === promoValidationGeneration) {
      promoValidating.value = false
    }
  }
}

function clearPromoCode() {
  promoCodeInput.value = ''
  promoApplied.value = null
  promoError.value = null
}

function applyCheckoutIntentFromRoute() {
  const q = route.query
  const plan = q.checkout_plan
  if (plan === 'monthly' || plan === 'yearly' || plan === 'club') {
    selectedPlan.value = plan
  }
  const prov = q.checkout_provider
  if (prov === 'stripe' || prov === 'gocardless') {
    selectedProvider.value = prov
  }
}

function activatePanel() {
  applyCheckoutIntentFromRoute()
  clearPromoCode()
  loadPrices()
}

watch(() => props.active, (isActive) => {
  if (isActive) activatePanel()
}, { immediate: true })

watch(selectedPlan, () => {
  promoApplied.value = null
  promoError.value = null
})

watch(activePaymentTab, (tab) => {
  selectedProvider.value = tab === 'bank' ? 'gocardless' : 'stripe'
  promoApplied.value = null
  promoError.value = null
  if (promoCodeInput.value.trim() && isLoggedIn.value) {
    void validatePromoCode()
  }
})

watch(selectedProvider, () => {
  promoApplied.value = null
  promoError.value = null
  if (promoCodeInput.value.trim() && isLoggedIn.value) {
    void validatePromoCode()
  }
})

watch(promoCodeInput, (newInput) => {
  const trimmed = newInput.trim()
  const appliedCode = promoApplied.value?.code ?? ''
  if (trimmed !== appliedCode) {
    promoApplied.value = null
    promoError.value = null
  }
})

watch(() => route.fullPath, () => {
  if (props.active) applyCheckoutIntentFromRoute()
})
</script>
