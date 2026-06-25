<template>
  <div class="space-y-4">
    <p v-if="description" class="text-sm text-gray-600 dark:text-gray-400">
      {{ description }}
    </p>

    <div v-if="loadingPrices" class="h-10 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-800" />

    <div v-else class="grid gap-2" :class="planGridClass">
      <button
        v-for="plan in visiblePlans"
        :key="plan"
        type="button"
        class="min-w-0 rounded-lg border-2 px-2 py-2.5 text-center transition-all cursor-pointer"
        :class="planButtonClass(plan)"
        @click="selectedPlan = plan"
      >
        <p class="text-[10px] uppercase tracking-wide mb-0.5 leading-tight text-gray-500 dark:text-gray-400">
          {{ planLabel(plan) }}
        </p>
        <p class="text-base font-bold leading-tight text-gray-900 dark:text-white">
          {{ formatPrice(planPrice(plan)) }}
        </p>
      </button>
    </div>

    <p v-if="checkoutError" class="text-sm text-red-600 dark:text-red-400">{{ checkoutError }}</p>

    <button
      type="button"
      class="inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white dark:text-white text-sm font-medium rounded-lg transition-colors w-full sm:w-auto"
      :disabled="startingCheckout || loadingPrices"
      @click="startLegacyCheckout"
    >
      <span v-if="startingCheckout">{{ strings.checkoutRedirecting }}</span>
      <span v-else>{{ ctaLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'

const props = withDefaults(defineProps<{
  returnPath?: string
  description?: string
  ctaLabel?: string
  /** When true, always show legacy checkout even if hidden for new subscribers. */
  forceLegacy?: boolean
}>(), {
  returnPath: '/account',
  ctaLabel: '',
  forceLegacy: false,
})

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string
const { isLoggedIn, authHeader, subscription } = useAuth()
const { startLoginFlow } = useLoginFlow()

type PlanType = 'monthly' | 'yearly' | 'club'
type Prices = Record<PlanType, number | null>

const selectedPlan = ref<PlanType>('monthly')
const prices = ref<Prices>({ monthly: null, yearly: null, club: null })
const allowedPlans = ref<PlanType[]>(['monthly', 'yearly', 'club'])
const loadingPrices = ref(true)
const startingCheckout = ref(false)
const checkoutError = ref<string | null>(null)

const ctaLabel = computed(() => props.ctaLabel || strings.accountRelinkPaymentMethod)
const planGridClass = computed(() => 'grid-cols-3 max-[22rem]:grid-cols-1')

const visiblePlans = computed(() =>
  allowedPlans.value.filter((plan) => planPrice(plan) != null),
)

function planLabel(plan: PlanType): string {
  if (plan === 'yearly') return strings.checkoutPlanYearly
  if (plan === 'club') return strings.checkoutPlanClub
  return strings.checkoutPlanMonthly
}

function formatPrice(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '…'
  return `€${amount.toFixed(2)}`
}

function planPrice(plan: PlanType): number | null {
  const value = prices.value[plan]
  return value != null && Number.isFinite(value) ? Number(value) : null
}

function planButtonClass(plan: PlanType): string {
  return selectedPlan.value === plan
    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500'
}

async function loadPrices() {
  loadingPrices.value = true
  checkoutError.value = null
  try {
    const res = await fetch(`${apiUrl}/api/account/pricing`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

    const legacyRaw = data?.pricesByProvider?.legacy ?? {}
    prices.value = {
      monthly: legacyRaw.monthly != null ? Number(legacyRaw.monthly) : Number(data.monthly ?? null),
      yearly: legacyRaw.yearly != null ? Number(legacyRaw.yearly) : Number(data.yearly ?? null),
      club: legacyRaw.club != null ? Number(legacyRaw.club) : Number(data.club ?? null),
    }

    const allowed = Array.isArray(data.allowedPlans)
      ? data.allowedPlans.filter((p: string) => p === 'monthly' || p === 'yearly' || p === 'club')
      : ['monthly', 'yearly', 'club']
    allowedPlans.value = allowed.length ? allowed : ['monthly', 'yearly', 'club']
    if (!allowedPlans.value.includes(selectedPlan.value)) {
      selectedPlan.value = allowedPlans.value[0] ?? 'monthly'
    }
  } catch (e: unknown) {
    checkoutError.value = e instanceof Error ? e.message : strings.checkoutPricesLoadFailed
  } finally {
    loadingPrices.value = false
  }
}

async function startLegacyCheckout() {
  checkoutError.value = null
  if (!isLoggedIn.value) {
    await startLoginFlow(props.returnPath)
    return
  }

  startingCheckout.value = true
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
    window.location.href = String(data.checkoutUrl)
  } catch {
    checkoutError.value = strings.networkError
  } finally {
    startingCheckout.value = false
  }
}

onMounted(() => {
  void loadPrices()
})

watch(() => subscription.value?.status, (status) => {
  if (status === 'needs_relink') void loadPrices()
})
</script>
