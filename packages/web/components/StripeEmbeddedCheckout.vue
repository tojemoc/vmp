<template>
  <ClientOnly>
    <div class="space-y-4">
      <div v-if="loading" class="text-sm" :class="mutedClass">
        {{ strings.checkoutStripeLoading }}
      </div>

      <div v-if="initError" class="text-sm text-red-400">
        {{ initError }}
      </div>

      <div v-show="!loading && !initError" class="space-y-4">
        <div
          v-show="showWalletSurface"
          ref="expressMountRef"
          class="min-h-[44px]"
        />

        <slot />

        <div v-show="showCardSurface">
          <div ref="paymentMountRef" />
          <button
            v-if="cardReady"
            type="button"
            class="mt-4 w-full text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
            :disabled="confirming"
            @click="confirmCardPayment"
          >
            {{ confirming ? strings.checkoutStripeProcessing : cardConfirmLabel }}
          </button>
        </div>
      </div>

      <p v-if="confirmError" class="text-sm text-red-400">{{ confirmError }}</p>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import strings from '~/utils/strings'

type PlanType = 'monthly' | 'yearly' | 'club'

/** Minimal Checkout Elements SDK surface (runtime API from js.stripe.com). */
interface StripeCheckoutSdk {
  createExpressCheckoutElement: (options?: Record<string, unknown>) => StripeExpressCheckoutElement
  createPaymentElement: (options?: Record<string, unknown>) => StripePaymentElement
  loadActions: () => Promise<{ type: string; actions?: { confirm: (opts?: Record<string, unknown>) => Promise<{ error?: { message?: string } }> } }>
  destroy?: () => void
}

type StripeExpressCheckoutEvent =
  | 'ready'
  | 'focus'
  | 'blur'
  | 'escape'
  | 'loaderror'
  | 'confirm'
  | 'cancel'

interface StripeExpressCheckoutElement {
  mount: (selector: string | HTMLElement) => void
  unmount: () => void
  on: (event: StripeExpressCheckoutEvent, handler: (payload: unknown) => void) => void
}

/** Checkout Elements SDK ready payload (availablePaymentMethods is deprecated but still sent). */
function expressWalletMethodsAvailable(payload: unknown): boolean {
  const event = payload as {
    availablePaymentMethods?: Record<string, { available?: boolean } | boolean>
    paymentMethods?: Record<string, { available?: boolean }>
  }
  const methods = event.paymentMethods ?? event.availablePaymentMethods
  if (!methods || typeof methods !== 'object') return false
  return Object.values(methods).some((entry) => {
    if (typeof entry === 'boolean') return entry
    if (entry && typeof entry === 'object' && 'available' in entry) return Boolean(entry.available)
    return true
  })
}

interface StripePaymentElement {
  mount: (selector: string | HTMLElement) => void
  unmount: () => void
}

const props = defineProps<{
  planType: PlanType
  promoCode: string
  returnPath: string
  embedded?: boolean
  /** Mount Apple Pay / Google Pay express buttons. */
  showWalletSurface: boolean
  /** Mount card / PayPal / SEPA payment element. */
  showCardSurface: boolean
  cardConfirmLabel?: string
}>()

const emit = defineEmits<{
  walletAvailable: [available: boolean]
}>()

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl as string
const { authHeader } = useAuth()

const loading = ref(true)
const initError = ref<string | null>(null)
const confirmError = ref<string | null>(null)
const confirming = ref(false)
const cardReady = ref(false)
const walletAvailable = ref(false)

const expressMountRef = ref<HTMLElement | null>(null)
const paymentMountRef = ref<HTMLElement | null>(null)

const cardConfirmLabel = computed(
  () => props.cardConfirmLabel ?? strings.checkoutSubscribeWithCard,
)

const mutedClass = computed(() =>
  props.embedded ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400',
)

let stripePromise: Promise<Stripe | null> | null = null
let checkoutInstance: StripeCheckoutSdk | null = null
let expressElement: StripeExpressCheckoutElement | null = null
let paymentElement: StripePaymentElement | null = null
let confirmActions: { confirm: (opts?: Record<string, unknown>) => Promise<{ error?: { message?: string } }> } | null = null
let sessionKey = ''
let teardownGeneration = 0

function getStripe() {
  if (!stripePromise) {
    stripePromise = fetch(`${apiUrl}/api/payments/stripe-config`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.publishableKey) throw new Error(strings.checkoutStripeNotConfigured)
        return loadStripe(data.publishableKey)
      })
      .catch((err) => {
        stripePromise = null
        throw err
      })
  }
  return stripePromise
}

async function createCheckoutSession(): Promise<string> {
  const res = await fetch(`${apiUrl}/api/payments/checkout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({
      planType: props.planType,
      provider: 'stripe',
      promoCode: props.promoCode || undefined,
      returnPath: props.returnPath,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.clientSecret) {
    throw new Error(data.error ?? strings.checkoutStartFailed)
  }
  return String(data.clientSecret)
}

function destroyElements() {
  expressElement?.unmount()
  paymentElement?.unmount()
  expressElement = null
  paymentElement = null
  confirmActions = null
  checkoutInstance?.destroy?.()
  checkoutInstance = null
  cardReady.value = false
}

function mountExpressElement() {
  if (!checkoutInstance || !expressMountRef.value || expressElement) return

  expressElement = checkoutInstance.createExpressCheckoutElement({
    buttonType: {
      applePay: 'subscribe',
      googlePay: 'subscribe',
    },
    paymentMethods: {
      applePay: 'auto',
      googlePay: 'auto',
      link: 'never',
      paypal: 'never',
      amazonPay: 'never',
      klarna: 'never',
    },
  })

  const syncWalletAvailability = (payload: unknown) => {
    const available = expressWalletMethodsAvailable(payload)
    walletAvailable.value = available
    emit('walletAvailable', available)
  }

  expressElement.on('ready', syncWalletAvailability)
  expressElement.on('loaderror', () => syncWalletAvailability(null))
  expressElement.on('confirm', (event: unknown) => {
    void confirmExpress(event)
  })
  expressElement.mount(expressMountRef.value)
}

function unmountExpressElement() {
  expressElement?.unmount()
  expressElement = null
  walletAvailable.value = false
  emit('walletAvailable', false)
}

function mountPaymentElement() {
  if (!checkoutInstance || !paymentMountRef.value || paymentElement) return
  paymentElement = checkoutInstance.createPaymentElement()
  paymentElement.mount(paymentMountRef.value)
  cardReady.value = true
}

function unmountPaymentElement() {
  paymentElement?.unmount()
  paymentElement = null
  cardReady.value = false
}

async function syncMountedSurfaces() {
  if (!checkoutInstance || loading.value) return
  await nextTick()

  if (props.showWalletSurface) {
    mountExpressElement()
  } else {
    unmountExpressElement()
  }

  if (props.showCardSurface) {
    mountPaymentElement()
  } else {
    unmountPaymentElement()
  }
}

async function setupCheckout() {
  const generation = ++teardownGeneration
  destroyElements()
  loading.value = true
  initError.value = null
  confirmError.value = null
  walletAvailable.value = false
  emit('walletAvailable', false)

  const nextKey = `${props.planType}:${props.promoCode}:${props.returnPath}`
  sessionKey = nextKey

  try {
    const stripe = await getStripe()
    if (!stripe || generation !== teardownGeneration) return

    const initCheckout = (stripe as Stripe & {
      initCheckoutElementsSdk?: (opts: { clientSecret: string }) => StripeCheckoutSdk
    }).initCheckoutElementsSdk
    if (typeof initCheckout !== 'function') {
      throw new Error(strings.checkoutStripeSdkUnavailable)
    }

    const clientSecret = await createCheckoutSession()
    if (generation !== teardownGeneration || sessionKey !== nextKey) return

    checkoutInstance = initCheckout.call(stripe, { clientSecret })
    const loadActionsResult = await checkoutInstance.loadActions()
    if (generation !== teardownGeneration) return

    if (loadActionsResult.type !== 'success' || !loadActionsResult.actions) {
      throw new Error(strings.checkoutStartFailed)
    }
    confirmActions = loadActionsResult.actions

    loading.value = false
    await syncMountedSurfaces()
    if (generation !== teardownGeneration) return
  } catch (err: unknown) {
    if (generation !== teardownGeneration) return
    initError.value = err instanceof Error ? err.message : strings.checkoutStartFailed
  } finally {
    if (generation === teardownGeneration && loading.value) {
      loading.value = false
    }
  }
}

async function confirmExpress(event: unknown) {
  if (!confirmActions) return
  confirmError.value = null
  confirming.value = true
  try {
    const { error } = await confirmActions.confirm({ expressCheckoutConfirmEvent: event })
    if (error?.message) confirmError.value = error.message
  } catch {
    confirmError.value = strings.networkError
  } finally {
    confirming.value = false
  }
}

async function confirmCardPayment() {
  if (!confirmActions) return
  confirmError.value = null
  confirming.value = true
  try {
    const { error } = await confirmActions.confirm()
    if (error?.message) confirmError.value = error.message
  } catch {
    confirmError.value = strings.networkError
  } finally {
    confirming.value = false
  }
}

watch(
  () => [props.planType, props.promoCode, props.returnPath] as const,
  () => {
    void setupCheckout()
  },
  { immediate: true },
)

watch(
  () => [props.showWalletSurface, props.showCardSurface] as const,
  () => {
    void syncMountedSurfaces()
  },
)

onBeforeUnmount(() => {
  teardownGeneration++
  destroyElements()
})
</script>
