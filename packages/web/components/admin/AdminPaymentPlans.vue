<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="font-semibold text-gray-900 dark:text-white">Plans &amp; pricing</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Stripe is the default checkout provider. Configure plan amounts and Stripe price IDs.</p>
      </div>
      <button type="button" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm" :disabled="loading" @click="loadPlans">Reload</button>
    </div>

    <div v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageClass">{{ message }}</div>

    <div v-if="loading && !plans.length" class="text-sm text-gray-500 dark:text-gray-400">Loading plans…</div>

    <div v-else class="space-y-2">
      <div
        v-for="plan in plans"
        :key="plan.id"
        class="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
      >
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex-1 min-w-[10rem]">
            <p class="font-medium text-gray-900 dark:text-white">{{ plan.label }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ plan.amountEur != null ? `€${plan.amountEur}` : '—' }} / {{ plan.interval }}
            </p>
          </div>
          <button
            type="button"
            class="font-mono text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-[12rem]"
            :title="plan.stripePriceId || 'No price ID'"
            @click="copyPriceId(plan.stripePriceId)"
          >
            {{ plan.stripePriceId || 'price_…' }}
          </button>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              class="rounded border-gray-300 dark:border-gray-600"
              :checked="plan.enabled"
              @change="toggleEnabled(plan, ($event.target as HTMLInputElement).checked)"
            >
            Enabled
          </label>
          <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="toggleEdit(plan.id)">
            {{ editingId === plan.id ? 'Close' : 'Edit' }}
          </button>
        </div>
        <div v-if="editingId === plan.id" class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label class="text-xs text-gray-600 dark:text-gray-300 block">Label
            <input v-model="editForm.label" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
          <label class="text-xs text-gray-600 dark:text-gray-300 block">Amount EUR
            <input v-model="editForm.amountEur" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
          <label class="text-xs text-gray-600 dark:text-gray-300 block">Interval
            <select v-model="editForm.interval" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
          </label>
          <label class="text-xs text-gray-600 dark:text-gray-300 block md:col-span-3">Stripe price ID
            <input v-model="editForm.stripePriceId" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" placeholder="price_..." />
          </label>
          <div class="md:col-span-3">
            <button type="button" class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="saving" @click="savePlan(plan.id)">
              {{ saving ? 'Saving…' : 'Save plan' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showAddForm" class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-4 space-y-3">
      <h4 class="text-sm font-semibold text-gray-900 dark:text-white">New plan</h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="text-xs text-gray-600 dark:text-gray-300 block">Label
          <input v-model="addForm.label" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block">Amount EUR
          <input v-model="addForm.amountEur" type="text" inputmode="decimal" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block">Interval
          <select v-model="addForm.interval" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
            <option value="month">month</option>
            <option value="year">year</option>
          </select>
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block">Stripe price ID (required)
          <input v-model="addForm.stripePriceId" type="text" class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" />
        </label>
      </div>
      <div class="flex gap-2">
        <button type="button" class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="saving || !addForm.stripePriceId.trim()" @click="addPlan">Save plan</button>
        <button type="button" class="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm" @click="showAddForm = false">Cancel</button>
      </div>
    </div>
    <button v-else type="button" class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline" @click="showAddForm = true">+ Add plan</button>

    <div v-if="legacy.configured" class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <h4 class="font-semibold text-gray-900 dark:text-white">Legacy provider</h4>
      <p class="text-xs text-gray-600 dark:text-gray-400">
        When a legacy subscriber's plan expires or enters past_due, they will see a prompt to manage their payment method at the URL below. Monthly subscribers are most at risk of bank-side blocking when the merchant name changes.
      </p>
      <label class="block text-sm text-gray-700 dark:text-gray-300">
        Manage subscription URL
        <input v-model="legacy.manageSubscriptionUrl" type="url" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs" placeholder="https://..." />
      </label>
      <label class="block text-sm text-gray-700 dark:text-gray-300">
        Legacy provider display name
        <input v-model="legacy.providerName" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" placeholder="Qerko" />
      </label>
      <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input v-model="legacy.showManageButton" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
        Show "Manage payment method" button to legacy subscribers
      </label>
      <button type="button" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="saving" @click="saveLegacy">Save legacy settings</button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface PaymentPlan {
  id: string
  label: string
  stripePriceId: string
  amountEur: number | null
  interval: string
  enabled: boolean
}

interface LegacySettings {
  configured: boolean
  manageSubscriptionUrl: string
  providerName: string
  showManageButton: boolean
}

const config = useRuntimeConfig()
const { authHeader } = useAuth()

const plans = ref<PaymentPlan[]>([])
const legacy = ref<LegacySettings>({
  configured: false,
  manageSubscriptionUrl: '',
  providerName: '',
  showManageButton: false,
})
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageClass = ref('')
const editingId = ref<string | null>(null)
const showAddForm = ref(false)
const editForm = ref({ label: '', amountEur: '', interval: 'month', stripePriceId: '' })
const addForm = ref({ label: '', amountEur: '', interval: 'month', stripePriceId: '' })

async function loadPlans() {
  loading.value = true
  message.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/plans`, { headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    plans.value = data.plans ?? []
    if (data.legacy) {
      legacy.value = {
        configured: Boolean(data.legacy.configured),
        manageSubscriptionUrl: data.legacy.manageSubscriptionUrl ?? '',
        providerName: data.legacy.providerName ?? '',
        showManageButton: Boolean(data.legacy.showManageButton),
      }
    }
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Failed to load plans'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    loading.value = false
  }
}

function toggleEdit(id: string) {
  if (editingId.value === id) {
    editingId.value = null
    return
  }
  const plan = plans.value.find((p) => p.id === id)
  if (!plan) return
  editForm.value = {
    label: plan.label,
    amountEur: plan.amountEur != null ? String(plan.amountEur) : '',
    interval: plan.interval || 'month',
    stripePriceId: plan.stripePriceId,
  }
  editingId.value = id
}

async function patchPlan(plan: Record<string, unknown>) {
  saving.value = true
  message.value = ''
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/plans`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ plan }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    plans.value = data.plans ?? plans.value
    message.value = 'Plan saved.'
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    editingId.value = null
    showAddForm.value = false
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Save failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    saving.value = false
  }
}

function savePlan(id: string) {
  void patchPlan({
    id,
    label: editForm.value.label,
    amountEur: editForm.value.amountEur,
    interval: editForm.value.interval,
    stripePriceId: editForm.value.stripePriceId,
  })
}

async function addPlan() {
  await patchPlan({
    label: addForm.value.label,
    amountEur: addForm.value.amountEur,
    interval: addForm.value.interval,
    stripePriceId: addForm.value.stripePriceId,
    enabled: true,
  })
  addForm.value = { label: '', amountEur: '', interval: 'month', stripePriceId: '' }
}

function toggleEnabled(plan: PaymentPlan, enabled: boolean) {
  void patchPlan({ id: plan.id, enabled })
}

async function saveLegacy() {
  saving.value = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/plans`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        legacy: {
          manageSubscriptionUrl: legacy.value.manageSubscriptionUrl,
          providerName: legacy.value.providerName,
          showManageButton: legacy.value.showManageButton,
        },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    message.value = 'Legacy settings saved.'
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Save failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    saving.value = false
  }
}

async function copyPriceId(id: string) {
  if (!id || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(id)
    message.value = 'Price ID copied.'
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch {
    message.value = 'Could not copy to clipboard.'
    messageClass.value = 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200'
  }
}

onMounted(() => { void loadPlans() })
</script>
