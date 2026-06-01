<template>
  <div :class="embedded ? 'text-left' : 'text-center'">
    <div
      class="bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center"
      :class="[
        embedded ? 'w-16 h-16 mb-4' : compact ? 'w-12 h-12 mb-3 mx-auto' : 'w-16 h-16 mb-4 mx-auto',
      ]"
    >
      <svg
        class="text-gray-900"
        :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
      </svg>
    </div>

    <h3
      class="font-bold mb-1"
      :class="[
        compact ? 'text-xl' : 'text-2xl mb-2',
        embedded ? 'text-gray-900 dark:text-white' : 'text-white',
      ]"
    >
      {{ strings.checkoutPremiumTitle }}
    </h3>
    <p
      :class="[
        compact ? 'mb-4 text-sm' : 'mb-6',
        embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400',
      ]"
    >
      {{ strings.checkoutPremiumSubtitle }}
    </p>

    <div
      v-if="loadingPrices"
      class="grid gap-2 mb-4"
      :class="planGridClass"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="h-[4.5rem] rounded-lg animate-pulse"
        :class="embedded ? 'bg-gray-200 dark:bg-gray-800' : 'bg-gray-800'"
      />
    </div>

    <div v-else-if="!priceError" class="grid gap-2 mb-4" :class="planGridClass">
      <button
        type="button"
        class="relative min-w-0 rounded-lg border-2 px-2 py-2.5 text-center transition-all cursor-pointer"
        :class="[planButtonClass('monthly'), compact ? 'pt-3.5' : 'pt-4']"
        @click="selectedPlan = 'monthly'"
      >
        <div
          class="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] font-semibold px-1.5 py-px rounded-full whitespace-nowrap leading-tight"
        >
          {{ strings.checkoutMostPopular }}
        </div>
        <p class="text-[10px] uppercase tracking-wide mb-0.5 leading-tight" :class="planLabelClass">{{ strings.checkoutPlanMonthly }}</p>
        <p class="text-base font-bold leading-tight" :class="planPriceClass">{{ formatPrice(primaryPlanPrice('monthly')) }}</p>
        <p class="text-[10px] mt-0.5 leading-tight" :class="planSubtextClass">{{ strings.checkoutPerMonth }}</p>
      </button>

      <button
        type="button"
        class="min-w-0 rounded-lg border-2 px-2 py-2.5 text-center transition-all cursor-pointer"
        :class="planButtonClass('yearly')"
        @click="selectedPlan = 'yearly'"
      >
        <p class="text-[10px] uppercase tracking-wide mb-0.5 leading-tight" :class="planLabelClass">{{ strings.checkoutPlanYearly }}</p>
        <p class="text-base font-bold leading-tight" :class="planPriceClass">{{ formatPrice(primaryPlanPrice('yearly')) }}</p>
        <p class="text-[10px] mt-0.5 leading-tight" :class="planSubtextClass">{{ strings.checkoutPerYear }}</p>
      </button>

      <button
        type="button"
        class="min-w-0 rounded-lg border-2 px-2 py-2.5 text-center transition-all cursor-pointer"
        :class="planButtonClass('club')"
        @click="selectedPlan = 'club'"
      >
        <p class="text-[10px] uppercase tracking-wide mb-0.5 leading-tight" :class="planLabelClass">{{ strings.checkoutPlanClub }}</p>
        <p class="text-base font-bold leading-tight" :class="planPriceClass">{{ formatPrice(primaryPlanPrice('club')) }}</p>
        <p class="text-[10px] mt-0.5 leading-tight" :class="planSubtextClass">{{ strings.checkoutPerYear }}</p>
      </button>
    </div>

    <div v-if="priceError" class="text-red-400 text-sm mb-6">
      {{ strings.checkoutPricesLoadFailed }}
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

    <div
      v-if="!loadingPrices && !priceError && isLoggedIn && (stripeEnabled || gocardlessEnabled)"
      class="mb-4 text-left"
    >
      <StripeEmbeddedCheckout
        v-if="stripeEnabled && stripeCheckoutMounted"
        :plan-type="selectedPlan"
        :promo-code="promoApplied?.code ?? ''"
        :return-path="returnPath"
        :embedded="embedded"
        :show-wallet-surface="showWalletSurface"
        :show-card-surface="showCardSurface"
        @wallet-available="onWalletAvailable"
      >
        <div v-if="showMoreToggle" class="space-y-3">
          <button
            type="button"
            class="w-full py-2.5 px-4 text-sm font-medium rounded-lg border transition-colors"
            :class="moreToggleClass"
            :aria-expanded="moreExpanded"
            @click="toggleMore"
          >
            {{ moreExpanded ? strings.checkoutHidePaymentMethods : strings.checkoutMorePaymentMethods }}
          </button>

          <div
            v-if="moreExpanded"
            class="space-y-2"
            role="region"
            :aria-label="strings.checkoutMorePaymentMethods"
          >
            <button
              v-if="walletAvailable"
              type="button"
              class="w-full text-left rounded-lg border-2 p-4 transition-all"
              :class="moreOptionClass('card')"
              @click="selectMoreMethod('card')"
            >
              <p class="font-semibold" :class="embedded ? 'text-gray-900 dark:text-white' : 'text-white'">
                {{ strings.checkoutPayByCard }}
              </p>
              <p class="text-xs mt-0.5" :class="embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400'">
                {{ strings.checkoutPayByCardHint }}
              </p>
            </button>

            <template v-if="gocardlessEnabled">
              <button
                v-if="walletAvailable"
                type="button"
                class="w-full text-left rounded-lg border-2 p-4 transition-all"
                :class="moreOptionClass('bank')"
                @click="selectMoreMethod('bank')"
              >
                <p class="font-semibold" :class="embedded ? 'text-gray-900 dark:text-white' : 'text-white'">
                  {{ strings.checkoutPayWithBank(formatPrice(providerPlanPrice('gocardless', selectedPlan))) }}
                </p>
              </button>

              <button
                v-if="walletAvailable && moreMethod === 'bank'"
                type="button"
                class="w-full text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700"
                :disabled="checkingOut || !providerPlanPrice('gocardless', selectedPlan)"
                @click="handleSubscribe('gocardless')"
              >
                <span v-if="checkingOut">{{ strings.checkoutRedirecting }}</span>
                <span v-else>{{ strings.checkoutPayWithBank(formatPrice(providerPlanPrice('gocardless', selectedPlan))) }}</span>
              </button>
            </template>
          </div>
        </div>
      </StripeEmbeddedCheckout>

      <div v-else-if="gocardlessEnabled && !stripeEnabled" class="space-y-2">
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
  /** Tighter layout for the watch-page premium overlay. */
  compact?: boolean
}>(), {
  reopenPremiumOnReturn: false,
  active: true,
  embedded: false,
  compact: false,
})

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string
const route = useRoute()
const { isLoggedIn, authHeader } = useAuth()
const { startLoginFlow } = useLoginFlow()

type PlanType = 'monthly' | 'yearly' | 'club'
type PaymentProvider = 'stripe' | 'gocardless'
type MorePaymentMethod = 'card' | 'bank'

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
const walletAvailable = ref(false)
/** False until Stripe express checkout fires `ready` (avoids flashing card before wallet detection). */
const walletDetectionDone = ref(false)
const moreExpanded = ref(false)
const moreMethod = ref<MorePaymentMethod | null>(null)
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

/** Three columns by default; stack only on very narrow viewports where columns would crowd. */
const planGridClass = computed(() =>
  'grid-cols-3 max-[22rem]:grid-cols-1',
)

const stripeEnabled = computed(() => availableProviders.value.includes('stripe'))
const gocardlessEnabled = computed(() => availableProviders.value.includes('gocardless'))

const stripeCheckoutMounted = computed(() => stripeEnabled.value)

/** Apple / Google Pay above the fold (mount express until detection finishes). */
const showWalletSurface = computed(() => {
  if (!stripeEnabled.value) return false
  if (!walletDetectionDone.value) return true
  return walletAvailable.value
})

/**
 * Card / PayPal / SEPA form: primary when no wallet, or after user picks "Pay by card" under More.
 */
const showCardSurface = computed(() => {
  if (!stripeEnabled.value || !walletDetectionDone.value) return false
  if (!walletAvailable.value) return true
  return moreExpanded.value && moreMethod.value === 'card'
})

/** More toggle when wallet is primary and at least one alternate method exists. */
const showMoreToggle = computed(() => {
  if (!walletDetectionDone.value || !walletAvailable.value) return false
  if (gocardlessEnabled.value) return true
  return stripeEnabled.value
})

const moreToggleClass = computed(() => {
  if (props.embedded) {
    return moreExpanded.value
      ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white'
      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500'
  }
  return moreExpanded.value
    ? 'border-gray-500 bg-gray-800 text-white'
    : 'border-gray-600 bg-gray-800/80 text-gray-300 hover:border-gray-500 hover:text-white'
})

function moreOptionClass(method: MorePaymentMethod): string {
  const selected = moreMethod.value === method
  if (props.embedded) {
    return selected
      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500'
  }
  return selected
    ? 'border-blue-500 bg-blue-500/10'
    : 'border-gray-700 bg-gray-800 hover:border-gray-500'
}

function onWalletAvailable(available: boolean) {
  walletDetectionDone.value = true
  walletAvailable.value = available
  if (!available) {
    moreExpanded.value = false
    moreMethod.value = null
  }
}

function toggleMore() {
  moreExpanded.value = !moreExpanded.value
  if (!moreExpanded.value) {
    moreMethod.value = null
  }
}

function selectMoreMethod(method: MorePaymentMethod) {
  moreMethod.value = method
  if (method === 'bank') {
    selectedProvider.value = 'gocardless'
  } else {
    selectedProvider.value = 'stripe'
  }
}

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

function promoProviderForCheckout(): PaymentProvider {
  if (moreMethod.value === 'bank') return 'gocardless'
  return 'stripe'
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
  if (promoProviderForCheckout() !== providerAtRequest) return true
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
  const providerAtRequest = promoProviderForCheckout()
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
    if (prov === 'gocardless') {
      moreExpanded.value = true
      moreMethod.value = 'bank'
    }
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
  walletDetectionDone.value = false
  walletAvailable.value = false
  moreExpanded.value = false
  moreMethod.value = null
})

watch(moreMethod, () => {
  selectedProvider.value = moreMethod.value === 'bank' ? 'gocardless' : 'stripe'
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
