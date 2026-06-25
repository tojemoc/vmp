<script setup lang="ts">
import strings from '~/utils/strings'

const props = withDefaults(defineProps<{
  returnPath?: string
  embedded?: boolean
}>(), {
  returnPath: '/account',
  embedded: true,
})

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string
const { authHeader } = useAuth()

type PlanType = 'monthly' | 'yearly' | 'club'

const defaultPrices = { monthly: 6.90, yearly: 74.90, club: 109.00 }
const prices = ref({ ...defaultPrices })
const loadingPrices = ref(true)
const priceError = ref(false)
const selectedPlan = ref<PlanType>('monthly')
const working = ref(false)
const checkoutError = ref<string | null>(null)

function formatPrice(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '…'
  return `€${amount.toFixed(2)}`
}

function planPrice(plan: PlanType): number | null {
  const value = prices.value[plan]
  return Number.isFinite(value) ? Number(value) : null
}

const planButtonClass = computed(() => (plan: PlanType) => {
  const selected = selectedPlan.value === plan
  if (props.embedded) {
    return selected
      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500'
  }
  return selected ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 bg-gray-800 hover:border-gray-500'
})

const planLabelClass = computed(() =>
  props.embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400',
)
const planPriceClass = computed(() =>
  props.embedded ? 'text-gray-900 dark:text-white' : 'text-white',
)
const planSubtextClass = computed(() =>
  props.embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500',
)

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
    const legacyRaw = data?.pricesByProvider?.legacy ?? data ?? {}
    prices.value = {
      monthly: Number(legacyRaw.monthly ?? data.monthly ?? defaultPrices.monthly),
      yearly: Number(legacyRaw.yearly ?? data.yearly ?? defaultPrices.yearly),
      club: Number(legacyRaw.club ?? data.club ?? defaultPrices.club),
    }
  } catch {
    priceError.value = true
  } finally {
    loadingPrices.value = false
  }
}

async function startLegacyRelink() {
  if (working.value) return
  working.value = true
  checkoutError.value = null
  try {
    const res = await fetch(`${apiUrl}/api/payments/legacy/checkout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        planType: selectedPlan.value,
        returnPath: props.returnPath,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.checkoutUrl) {
      checkoutError.value = data.error ?? strings.checkoutStartFailed
      return
    }
    window.location.href = data.checkoutUrl
  } catch {
    checkoutError.value = strings.networkError
  } finally {
    working.value = false
  }
}

onMounted(() => {
  void loadPrices()
})
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-600 dark:text-gray-400">
      {{ strings.accountRelinkCheckoutIntro }}
    </p>

    <div v-if="loadingPrices" class="grid grid-cols-3 gap-2">
      <div
        v-for="i in 3"
        :key="i"
        class="h-16 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-800"
      />
    </div>

    <div v-else-if="!priceError" class="grid grid-cols-3 gap-2 max-[22rem]:grid-cols-1">
      <button
        v-for="plan in (['monthly', 'yearly', 'club'] as const)"
        :key="plan"
        type="button"
        class="min-w-0 rounded-lg border-2 px-2 py-2.5 text-center transition-all cursor-pointer"
        :class="planButtonClass(plan)"
        @click="selectedPlan = plan"
      >
        <p class="text-[10px] uppercase tracking-wide mb-0.5 leading-tight" :class="planLabelClass">
          {{ plan === 'monthly' ? strings.checkoutPlanMonthly : plan === 'yearly' ? strings.checkoutPlanYearly : strings.checkoutPlanClub }}
        </p>
        <p class="text-base font-bold leading-tight" :class="planPriceClass">
          {{ formatPrice(planPrice(plan)) }}
        </p>
        <p class="text-[10px] mt-0.5 leading-tight" :class="planSubtextClass">
          {{ plan === 'monthly' ? strings.checkoutPerMonth : strings.checkoutPerYear }}
        </p>
      </button>
    </div>

    <p v-if="priceError" class="text-sm text-red-600 dark:text-red-400">
      {{ strings.checkoutPricesLoadFailed }}
    </p>
    <p v-if="checkoutError" class="text-sm text-red-600 dark:text-red-400">
      {{ checkoutError }}
    </p>

    <button
      type="button"
      class="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white dark:text-white text-sm font-medium rounded-lg transition-colors"
      :disabled="working || loadingPrices || priceError"
      @click="startLegacyRelink"
    >
      {{ working ? strings.accountRelinkCheckoutWorking : strings.accountRelinkPaymentMethod }}
    </button>
  </div>
</template>
