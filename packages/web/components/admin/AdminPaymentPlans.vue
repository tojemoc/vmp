<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="font-semibold text-gray-900 dark:text-white">Payment gateways &amp; plans</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Enable checkout providers, set their display order, then manage plan prices under Plans.
        </p>
      </div>
      <button
        type="button"
        class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        :disabled="loading"
        @click="reloadAll"
      >
        Reload
      </button>
    </div>

    <div v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageClass">
      {{ message }}
    </div>

    <!-- ── Gateways ─────────────────────────────────────────────────────── -->
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
      <div>
        <h4 class="font-semibold text-gray-900 dark:text-white">Gateways</h4>
        <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
          Disable Qerko for new subscribers while keeping it available for imported users who need
          to relink (via dedicated relink checkout).
        </p>
      </div>

      <div class="flex flex-wrap gap-4">
        <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            v-model="enabledProviders"
            type="checkbox"
            value="stripe"
            class="rounded border-gray-300 dark:border-gray-600"
            @change="syncProviderOrderFromEnabled"
          >
          Stripe (card, PayPal, SEPA)
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            v-model="enabledProviders"
            type="checkbox"
            value="legacy"
            class="rounded border-gray-300 dark:border-gray-600"
            :disabled="!legacy.configured"
            @change="syncProviderOrderFromEnabled"
          >
          Qerko (bank / legacy)
          <span v-if="!legacy.configured" class="text-xs text-amber-700 dark:text-amber-300"
            >(not configured on server)</span
          >
        </label>
      </div>

      <p
        v-if="legacy.configured && !legacy.hasWebhookSecret"
        class="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded px-3 py-2"
      >
        Warning: Qerko API credentials are set but
        <code class="font-mono">LEGACY_ESHOP_WEBHOOK_SECRET</code>
        is missing. Enabling Qerko at checkout can collect payment without activating subscriptions
        until the webhook secret is configured.
      </p>

      <div v-if="orderedEnabledProviders.length" class="space-y-2">
        <p class="text-xs font-medium text-gray-700 dark:text-gray-300">
          Checkout order (drag to reorder)
        </p>
        <ul class="space-y-1.5 max-w-md">
          <li
            v-for="(provider, index) in orderedEnabledProviders"
            :key="provider"
            draggable="true"
            class="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white cursor-grab active:cursor-grabbing select-none"
            :class="
              dragOverIndex === index ? 'ring-2 ring-blue-400 border-blue-400' : ''
            "
            @dragstart="onProviderDragStart(index)"
            @dragover.prevent="dragOverIndex = index"
            @dragleave="dragOverIndex = null"
            @drop.prevent="onProviderDrop(index)"
            @dragend="onProviderDragEnd"
          >
            <span class="text-gray-400 dark:text-gray-500 font-mono text-xs" aria-hidden="true"
              >⋮⋮</span
            >
            <span class="flex-1">{{ providerLabel(provider) }}</span>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="index === 0"
                :aria-label="`Move ${providerLabel(provider)} up in checkout order`"
                @click="moveProviderUp(index)"
              >
                ↑
              </button>
              <button
                type="button"
                class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="index === orderedEnabledProviders.length - 1"
                :aria-label="`Move ${providerLabel(provider)} down in checkout order`"
                @click="moveProviderDown(index)"
              >
                ↓
              </button>
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">#{{ index + 1 }}</span>
          </li>
        </ul>
      </div>
      <p v-else class="text-xs text-amber-700 dark:text-amber-300">
        Enable at least one gateway above.
      </p>

      <div class="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
        <h5 class="text-sm font-semibold text-gray-900 dark:text-white">
          Qerko subscriber management
        </h5>
        <p class="text-xs text-gray-600 dark:text-gray-400">
          Customers with a Qerko subscription see a “Manage with Qerko” button that opens this URL (the
          Qerko manage / app link from the gateway docs). Leave empty to hide the button.
        </p>
        <label class="block text-sm text-gray-700 dark:text-gray-300">
          Manage with Qerko URL
          <input
            v-model="legacy.manageSubscriptionUrl"
            type="url"
            class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
            placeholder="https://…"
          >
        </label>
        <label class="block text-sm text-gray-700 dark:text-gray-300">
          Provider display name
          <input
            v-model="legacy.providerName"
            type="text"
            class="mt-1 w-full max-w-md px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            placeholder="Qerko"
          >
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            v-model="legacy.showManageButton"
            type="checkbox"
            class="rounded border-gray-300 dark:border-gray-600"
          >
          Show “Manage with {{ legacy.providerName.trim() || 'Qerko' }}” to Qerko subscribers
        </label>
      </div>

      <button
        type="button"
        class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white dark:text-white text-sm font-semibold disabled:opacity-50"
        :disabled="saving || !enabledProviders.length"
        @click="saveGatewaySettings"
      >
        {{ saving ? 'Saving…' : 'Save gateway settings' }}
      </button>
    </div>

    <!-- ── Plans ────────────────────────────────────────────────────────── -->
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
      <div>
        <h4 class="font-semibold text-gray-900 dark:text-white">Plans</h4>
        <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">
          Display amounts, Stripe price IDs, and optional Qerko price overrides. Use either
          <code class="font-mono text-[11px]">9.99</code>
          or
          <code class="font-mono text-[11px]">9,99</code>
          for decimals.
        </p>
      </div>

      <div v-if="loading && !plans.length" class="text-sm text-gray-500 dark:text-gray-400">
        Loading plans…
      </div>

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
                {{ plan.amountEur != null ? `€${formatAmount(plan.amountEur)}` : '—' }}
                / {{ plan.interval }}
                <span v-if="legacyPrices[plan.id as LegacyPlanKey]" class="ml-1">
                  · Qerko €{{ legacyPrices[plan.id as LegacyPlanKey] || '—' }}
                </span>
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
            <button
              type="button"
              class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              @click="toggleEdit(plan.id)"
            >
              {{ editingId === plan.id ? 'Close' : 'Edit' }}
            </button>
          </div>
          <div
            v-if="editingId === plan.id"
            class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <label class="text-xs text-gray-600 dark:text-gray-300 block"
              >Label
              <input
                v-model="editForm.label"
                type="text"
                class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
            </label>
            <label class="text-xs text-gray-600 dark:text-gray-300 block"
              >Display amount EUR
              <input
                v-model="editForm.amountEur"
                type="text"
                inputmode="decimal"
                class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="9,99 or 9.99"
              >
            </label>
            <label class="text-xs text-gray-600 dark:text-gray-300 block"
              >Interval
              <select
                v-model="editForm.interval"
                class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="month">month</option>
                <option value="year">year</option>
              </select>
            </label>
            <label class="text-xs text-gray-600 dark:text-gray-300 block md:col-span-2"
              >Stripe price ID
              <input
                v-model="editForm.stripePriceId"
                type="text"
                class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
                placeholder="price_..."
              >
            </label>
            <label v-if="isCorePlan(plan.id)" class="text-xs text-gray-600 dark:text-gray-300 block"
              >Qerko price EUR
              <input
                v-model="editForm.legacyPriceEur"
                type="text"
                inputmode="decimal"
                class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="optional override"
              >
              <span class="mt-1 block text-[11px] text-gray-500 dark:text-gray-400 font-normal">
                Subscribers see prices for all enabled payment methods at checkout.
              </span>
            </label>
            <div class="md:col-span-3">
              <button
                type="button"
                class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white dark:text-white text-sm font-semibold disabled:opacity-50"
                :disabled="saving"
                @click="savePlan(plan.id)"
              >
                {{ saving ? 'Saving…' : 'Save plan' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="showAddForm"
        class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-4 space-y-3"
      >
        <h5 class="text-sm font-semibold text-gray-900 dark:text-white">New plan</h5>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="text-xs text-gray-600 dark:text-gray-300 block"
            >Label
            <input
              v-model="addForm.label"
              type="text"
              class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
          </label>
          <label class="text-xs text-gray-600 dark:text-gray-300 block"
            >Amount EUR
            <input
              v-model="addForm.amountEur"
              type="text"
              inputmode="decimal"
              class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="9,99 or 9.99"
            >
          </label>
          <label class="text-xs text-gray-600 dark:text-gray-300 block"
            >Interval
            <select
              v-model="addForm.interval"
              class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
          </label>
          <label class="text-xs text-gray-600 dark:text-gray-300 block"
            >Stripe price ID (required)
            <input
              v-model="addForm.stripePriceId"
              type="text"
              class="mt-1 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-xs"
            >
          </label>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
            :disabled="saving || !addForm.stripePriceId.trim()"
            @click="addPlan"
          >
            Save plan
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
            @click="showAddForm = false"
          >
            Cancel
          </button>
        </div>
      </div>
      <button
        v-else
        type="button"
        class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        @click="showAddForm = true"
      >
        + Add plan
      </button>
    </div>

    <!-- ── Recent Qerko orders ──────────────────────────────────────────── -->
    <div
      v-if="legacy.configured"
      class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
    >
      <div class="flex items-center justify-between gap-3">
        <h4 class="font-semibold text-gray-900 dark:text-white">Recent Qerko checkout orders</h4>
        <button
          type="button"
          class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          :disabled="ordersLoading"
          @click="loadLegacyOrders"
        >
          {{ ordersLoading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
      <p class="text-xs text-gray-600 dark:text-gray-400">
        Debug view of recent legacy payment_checkout_sessions (emails masked).
      </p>
      <div
        v-if="ordersLoading && !legacyOrders.length"
        class="text-sm text-gray-500 dark:text-gray-400"
      >
        Loading orders…
      </div>
      <div v-else-if="!legacyOrders.length" class="text-sm text-gray-500 dark:text-gray-400">
        No Qerko checkout sessions yet.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full text-xs text-left text-gray-700 dark:text-gray-300">
          <thead
            class="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700"
          >
            <tr>
              <th class="py-2 pr-3">Order ID</th>
              <th class="py-2 pr-3">Email</th>
              <th class="py-2 pr-3">Plan</th>
              <th class="py-2 pr-3">Status</th>
              <th class="py-2 pr-3">Created</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="order in legacyOrders"
              :key="order.id"
              class="border-b border-gray-100 dark:border-gray-800"
            >
              <td class="py-2 pr-3 font-mono">{{ order.orderId }}</td>
              <td class="py-2 pr-3">{{ order.email ?? '—' }}</td>
              <td class="py-2 pr-3">{{ order.planType }}</td>
              <td class="py-2 pr-3">{{ order.status }}</td>
              <td class="py-2 pr-3 whitespace-nowrap">{{ order.createdAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  interface PaymentPlan {
    id: string;
    label: string;
    stripePriceId: string;
    amountEur: number | null;
    interval: string;
    enabled: boolean;
  }

  interface LegacySettings {
    configured: boolean;
    hasWebhookSecret: boolean;
    manageSubscriptionUrl: string;
    providerName: string;
    showManageButton: boolean;
  }

  interface LegacyOrderRow {
    id: string;
    orderId: string;
    email: string | null;
    planType: string;
    status: string;
    createdAt: string;
  }

  type LegacyPlanKey = 'monthly' | 'yearly' | 'club';
  type PaymentProvider = 'stripe' | 'legacy';

  const CORE_PLANS: LegacyPlanKey[] = ['monthly', 'yearly', 'club'];

  const config = useRuntimeConfig();
  const { authHeader } = useAuth();

  const plans = ref<PaymentPlan[]>([]);
  const legacy = ref<LegacySettings>({
    configured: false,
    hasWebhookSecret: false,
    manageSubscriptionUrl: '',
    providerName: 'Qerko',
    showManageButton: false,
  });
  const enabledProviders = ref<PaymentProvider[]>(['stripe']);
  const providerOrder = ref<PaymentProvider[]>(['stripe', 'legacy']);
  const legacyPrices = ref<Record<LegacyPlanKey, string>>({
    monthly: '',
    yearly: '',
    club: '',
  });
  const basePrices = ref<Record<LegacyPlanKey, string>>({
    monthly: '',
    yearly: '',
    club: '',
  });
  const stripePrices = ref<Record<LegacyPlanKey, string>>({
    monthly: '',
    yearly: '',
    club: '',
  });
  const stripePriceIds = ref<Record<LegacyPlanKey, string>>({
    monthly: '',
    yearly: '',
    club: '',
  });
  const allowedPlansSetting = ref<string[]>(['monthly', 'yearly', 'club']);
  const legacyOrders = ref<LegacyOrderRow[]>([]);
  const ordersLoading = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const message = ref('');
  const messageClass = ref('');
  const editingId = ref<string | null>(null);
  const showAddForm = ref(false);
  const editForm = ref({
    label: '',
    amountEur: '',
    interval: 'month',
    stripePriceId: '',
    legacyPriceEur: '',
  });
  const addForm = ref({ label: '', amountEur: '', interval: 'month', stripePriceId: '' });
  const draggingIndex = ref<number | null>(null);
  const dragOverIndex = ref<number | null>(null);

  const orderedEnabledProviders = computed(() => {
    const enabled = new Set(enabledProviders.value);
    const ordered = providerOrder.value.filter((p) => enabled.has(p));
    for (const p of enabledProviders.value) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    return ordered;
  });

  function providerLabel(provider: PaymentProvider): string {
    if (provider === 'stripe') return 'Stripe (card, PayPal, SEPA)';
    return `Qerko (${legacy.value.providerName.trim() || 'bank / legacy'})`;
  }

  function isCorePlan(id: string): id is LegacyPlanKey {
    return CORE_PLANS.includes(id as LegacyPlanKey);
  }

  function formatAmount(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  function syncProviderOrderFromEnabled() {
    const enabled = new Set(enabledProviders.value);
    const next = providerOrder.value.filter((p) => enabled.has(p));
    for (const p of enabledProviders.value) {
      if (!next.includes(p)) next.push(p);
    }
    providerOrder.value = next;
  }

  function onProviderDragStart(index: number) {
    draggingIndex.value = index;
  }

  function onProviderDrop(targetIndex: number) {
    if (draggingIndex.value === null || draggingIndex.value === targetIndex) {
      dragOverIndex.value = null;
      return;
    }
    const list = [...orderedEnabledProviders.value];
    const [moved] = list.splice(draggingIndex.value, 1);
    if (!moved) return;
    list.splice(targetIndex, 0, moved);
    providerOrder.value = list;
    draggingIndex.value = null;
    dragOverIndex.value = null;
  }

  function onProviderDragEnd() {
    draggingIndex.value = null;
    dragOverIndex.value = null;
  }

  function moveProvider(fromIndex: number, toIndex: number) {
    const list = [...orderedEnabledProviders.value];
    if (
      fromIndex < 0 ||
      fromIndex >= list.length ||
      toIndex < 0 ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = list.splice(fromIndex, 1);
    if (!moved) return;
    list.splice(toIndex, 0, moved);
    providerOrder.value = list;
  }

  function moveProviderUp(index: number) {
    moveProvider(index, index - 1);
  }

  function moveProviderDown(index: number) {
    moveProvider(index, index + 1);
  }

  async function loadPaymentSettings() {
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/settings`, {
      headers: authHeader(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const enabled = Array.isArray(data.enabledProviders)
      ? data.enabledProviders.filter((p: string) => p === 'stripe' || p === 'legacy')
      : ['stripe'];
    enabledProviders.value = enabled.length ? enabled : ['stripe'];
    if (!legacy.value.configured) {
      enabledProviders.value = enabledProviders.value.filter((p) => p !== 'legacy');
    }
    const order = Array.isArray(data.providerOrder)
      ? data.providerOrder.filter((p: string) => p === 'stripe' || p === 'legacy')
      : ['stripe', 'legacy'];
    providerOrder.value = order.length ? order : ['stripe', 'legacy'];
    syncProviderOrderFromEnabled();
    const allowed = Array.isArray(data.allowedPlans)
      ? data.allowedPlans.filter((p: string) => p === 'monthly' || p === 'yearly' || p === 'club')
      : ['monthly', 'yearly', 'club'];
    allowedPlansSetting.value = allowed.length ? allowed : ['monthly', 'yearly', 'club'];
    const base = data.basePrices ?? {};
    basePrices.value = {
      monthly: String(base.monthly ?? ''),
      yearly: String(base.yearly ?? ''),
      club: String(base.club ?? ''),
    };
    const stripeProviderPrices = data.providerPrices?.stripe ?? {};
    stripePrices.value = {
      monthly: String(stripeProviderPrices.monthly ?? ''),
      yearly: String(stripeProviderPrices.yearly ?? ''),
      club: String(stripeProviderPrices.club ?? ''),
    };
    const stripeIds = data.stripePriceIds ?? {};
    stripePriceIds.value = {
      monthly: String(stripeIds.monthly ?? ''),
      yearly: String(stripeIds.yearly ?? ''),
      club: String(stripeIds.club ?? ''),
    };
    const legacyProviderPrices = data.providerPrices?.legacy ?? {};
    legacyPrices.value = {
      monthly: String(legacyProviderPrices.monthly ?? ''),
      yearly: String(legacyProviderPrices.yearly ?? ''),
      club: String(legacyProviderPrices.club ?? ''),
    };
  }

  async function loadLegacyOrders() {
    ordersLoading.value = true;
    try {
      const res = await fetch(
        `${config.public.apiUrl}/api/admin/payments/legacy?orders=1&limit=25`,
        {
          headers: authHeader(),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      legacyOrders.value = data.orders ?? [];
    } catch (e: unknown) {
      message.value = e instanceof Error ? e.message : 'Failed to load Qerko orders';
      messageClass.value =
        'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200';
    } finally {
      ordersLoading.value = false;
    }
  }

  async function reloadAll() {
    await loadPlans();
    await Promise.all([loadPaymentSettings(), loadLegacyOrders()]);
  }

  async function loadPlans() {
    loading.value = true;
    message.value = '';
    try {
      const res = await fetch(`${config.public.apiUrl}/api/admin/payments/plans`, {
        headers: authHeader(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      plans.value = data.plans ?? [];
      if (data.legacy) {
        legacy.value = {
          configured: Boolean(data.legacy.configured),
          hasWebhookSecret: Boolean(data.legacy.hasWebhookSecret),
          manageSubscriptionUrl: data.legacy.manageSubscriptionUrl ?? '',
          providerName: data.legacy.providerName || 'Qerko',
          showManageButton: Boolean(data.legacy.showManageButton),
        };
      }
      if (!legacy.value.configured) {
        enabledProviders.value = enabledProviders.value.filter((p) => p !== 'legacy');
        syncProviderOrderFromEnabled();
      }
    } catch (e: unknown) {
      message.value = e instanceof Error ? e.message : 'Failed to load plans';
      messageClass.value =
        'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200';
    } finally {
      loading.value = false;
    }
  }

  function toggleEdit(id: string) {
    if (editingId.value === id) {
      editingId.value = null;
      return;
    }
    const plan = plans.value.find((p) => p.id === id);
    if (!plan) return;
    editForm.value = {
      label: plan.label,
      amountEur: plan.amountEur != null ? String(plan.amountEur) : '',
      interval: plan.interval || 'month',
      stripePriceId: plan.stripePriceId,
      legacyPriceEur: isCorePlan(plan.id) ? legacyPrices.value[plan.id] : '',
    };
    editingId.value = id;
  }

  async function patchPlan(plan: Record<string, unknown>): Promise<boolean> {
    saving.value = true;
    message.value = '';
    try {
      const res = await fetch(`${config.public.apiUrl}/api/admin/payments/plans`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      plans.value = data.plans ?? plans.value;
      message.value = 'Plan saved.';
      messageClass.value =
        'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200';
      editingId.value = null;
      showAddForm.value = false;
      return true;
    } catch (e: unknown) {
      message.value = e instanceof Error ? e.message : 'Save failed';
      messageClass.value =
        'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200';
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function savePlan(id: string) {
    const legacyPriceEur = editForm.value.legacyPriceEur;
    const amountEur = editForm.value.amountEur;
    const stripePriceId = editForm.value.stripePriceId;
    const ok = await patchPlan({
      id,
      label: editForm.value.label,
      amountEur,
      interval: editForm.value.interval,
      stripePriceId,
    });
    if (!ok || !isCorePlan(id)) return;
    legacyPrices.value = {
      ...legacyPrices.value,
      [id]: legacyPriceEur,
    };
    if (amountEur.trim()) {
      basePrices.value = { ...basePrices.value, [id]: amountEur };
    }
    if (stripePriceId.trim()) {
      stripePriceIds.value = {
        ...stripePriceIds.value,
        [id]: stripePriceId,
      };
    }
    saving.value = true;
    try {
      await persistPricingSettings();
      message.value = 'Plan saved.';
      messageClass.value =
        'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200';
    } catch (e: unknown) {
      message.value = e instanceof Error ? e.message : 'Plan saved, but Qerko price failed to save';
      messageClass.value =
        'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200';
    } finally {
      saving.value = false;
    }
  }

  async function persistPricingSettings() {
    const res = await fetch(`${config.public.apiUrl}/api/admin/payments/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        enabledProviders: enabledProviders.value,
        providerOrder: orderedEnabledProviders.value,
        allowedPlans: allowedPlansSetting.value,
        basePrices: basePrices.value,
        providerPrices: {
          stripe: stripePrices.value,
          legacy: {
            monthly: legacyPrices.value.monthly,
            yearly: legacyPrices.value.yearly,
            club: legacyPrices.value.club,
          },
        },
        stripePriceIds: stripePriceIds.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    await loadPaymentSettings();
  }

  async function addPlan() {
    await patchPlan({
      label: addForm.value.label,
      amountEur: addForm.value.amountEur,
      interval: addForm.value.interval,
      stripePriceId: addForm.value.stripePriceId,
      enabled: true,
    });
    addForm.value = { label: '', amountEur: '', interval: 'month', stripePriceId: '' };
  }

  function toggleEnabled(plan: PaymentPlan, enabled: boolean) {
    void patchPlan({ id: plan.id, enabled });
  }

  async function saveGatewaySettings() {
    saving.value = true;
    message.value = '';
    try {
      if (!legacy.value.configured) {
        enabledProviders.value = enabledProviders.value.filter((p) => p !== 'legacy');
        syncProviderOrderFromEnabled();
      }
      if (!enabledProviders.value.length) {
        throw new Error('Enable at least one gateway before saving.');
      }
      await persistPricingSettings();
      const legacyRes = await fetch(`${config.public.apiUrl}/api/admin/payments/plans`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          legacy: {
            manageSubscriptionUrl: legacy.value.manageSubscriptionUrl,
            providerName: legacy.value.providerName.trim() || 'Qerko',
            showManageButton: legacy.value.showManageButton,
          },
        }),
      });
      const legacyData = await legacyRes.json().catch(() => ({}));
      if (!legacyRes.ok) throw new Error(legacyData.error || `HTTP ${legacyRes.status}`);
      message.value = 'Gateway settings saved.';
      messageClass.value =
        'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200';
      await loadPlans();
    } catch (e: unknown) {
      message.value = e instanceof Error ? e.message : 'Save failed';
      messageClass.value =
        'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200';
    } finally {
      saving.value = false;
    }
  }

  async function copyPriceId(id: string) {
    if (!id || !import.meta.client) return;
    try {
      await navigator.clipboard.writeText(id);
      message.value = 'Price ID copied.';
      messageClass.value =
        'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200';
    } catch {
      message.value = 'Could not copy to clipboard.';
      messageClass.value =
        'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200';
    }
  }

  onMounted(() => {
    void reloadAll();
  });
</script>
