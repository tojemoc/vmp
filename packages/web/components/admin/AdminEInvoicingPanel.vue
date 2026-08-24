<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">E-invoicing</h2>
      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
        SK Peppol UBL / CZ ISDOC settings, seller identity, and invoice ledger. Transmission uses
        stub mode until a Peppol Access Point is configured.
      </p>
    </div>

    <div v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageClass">
      {{ message }}
    </div>

    <div class="flex flex-wrap gap-2 border-b border-gray-200 pb-2 dark:border-gray-700">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        type="button"
        class="rounded-lg px-3 py-1.5 text-sm font-medium"
        :class="
          activeSubTab === tab.id
            ? 'bg-blue-600 text-white dark:text-white'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
        "
        @click="activeSubTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="loading" class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>

    <div v-else-if="activeSubTab === 'settings'" class="space-y-6">
      <section class="space-y-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Flags</h3>
        <label class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
          <input v-model="form.enabled" type="checkbox" class="rounded border-gray-300">
          Enable e-invoicing pipeline
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
          <input v-model="form.skVoluntaryEnabled" type="checkbox" class="rounded border-gray-300">
          SK voluntary Peppol (from {{ legalTimeline.skVoluntaryFrom || '2026-05-15' }})
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
          <input v-model="form.isdocEnabled" type="checkbox" class="rounded border-gray-300">
          CZ ISDOC generation enabled
        </label>
        <label class="block text-sm text-gray-700 dark:text-gray-300">
          B2C mode
          <select
            v-model="form.b2cMode"
            class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="pdf_archive">PDF archive</option>
            <option value="none">None</option>
          </select>
        </label>
        <label class="block text-sm text-gray-700 dark:text-gray-300">
          Invoice number prefix
          <input
            v-model="form.invoicePrefix"
            type="text"
            maxlength="16"
            class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
        </label>
        <label class="block text-sm text-gray-700 dark:text-gray-300">
          Delivery mode
          <select
            v-model="form.deliveryMode"
            class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="stub">Stub (dry-run transmission ids)</option>
            <option value="live">Live (requires Peppol AP credentials)</option>
          </select>
        </label>
        <label class="block text-sm text-gray-700 dark:text-gray-300">
          CZ electronic consent reference
          <input
            v-model="form.czElectronicConsentRef"
            type="text"
            class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
        </label>
      </section>

      <section class="space-y-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Seller</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Legal name
            <input
              v-model="form.seller.legalName"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Jurisdiction
            <select
              v-model="form.seller.jurisdiction"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="SK">SK</option>
              <option value="CZ">CZ</option>
            </select>
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            VAT ID
            <input
              v-model="form.seller.vatId"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Company ID (IČO)
            <input
              v-model="form.seller.companyId"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300 sm:col-span-2">
            Address line
            <input
              v-model="form.seller.addressLine1"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            City
            <input
              v-model="form.seller.addressCity"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Postal code
            <input
              v-model="form.seller.addressPostalCode"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Country
            <input
              v-model="form.seller.addressCountry"
              type="text"
              maxlength="2"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Peppol participant ID
            <input
              v-model="form.seller.peppolParticipantId"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Peppol scheme ID
            <input
              v-model="form.seller.peppolSchemeId"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
        </div>
      </section>

      <section class="space-y-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Peppol Access Point</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          API key is a Worker secret (<code class="text-xs">PEPPOL_AP_API_KEY</code>). Configured:
          {{ peppolApiKeyConfigured ? 'yes' : 'no' }}.
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Provider name
            <input
              v-model="form.peppol.accessPointProvider"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300">
            Sender ID
            <input
              v-model="form.peppol.accessPointSenderId"
              type="text"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
          <label class="block text-sm text-gray-700 dark:text-gray-300 sm:col-span-2">
            API URL
            <input
              v-model="form.peppol.accessPointApiUrl"
              type="url"
              class="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
          </label>
        </div>
      </section>

      <section
        class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-950/40 dark:text-gray-300"
      >
        <p class="font-semibold text-gray-900 dark:text-white">
          Stripe checkout (SK/CZ e-invoicing)
        </p>
        <p class="mt-1">
          When e-invoicing is enabled and seller jurisdiction is SK or CZ, checkout adds optional
          tax ID collection and billing address (<code class="text-xs">auto</code>
          — not required for all subscribers). Other deployments keep the standard checkout flow.
        </p>
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-400">
          Legal timeline — SK mandatory B2B: {{ legalTimeline.skMandatoryB2bDate }}; CZ B2B mandate:
          {{ legalTimeline.czB2bMandate }}; ViDA cross-border:
          {{ legalTimeline.euCrossBorderViDA }}.
        </p>
      </section>

      <button
        type="button"
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 dark:text-white"
        :disabled="saving"
        @click="saveSettings"
      >
        {{ saving ? 'Saving…' : 'Save settings' }}
      </button>
    </div>

    <div v-else class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <label class="text-sm text-gray-700 dark:text-gray-300">
          Status filter
          <select
            v-model="statusFilter"
            class="ml-2 rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            @change="loadInvoices"
          >
            <option value="">All</option>
            <option value="queued">queued</option>
            <option value="stub_sent">stub_sent</option>
            <option value="sent">sent</option>
            <option value="delivered">delivered</option>
            <option value="failed">failed</option>
            <option value="draft">draft</option>
          </select>
        </label>
        <button
          type="button"
          class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          @click="loadInvoices"
        >
          Refresh
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr
              class="border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400"
            >
              <th class="px-2 py-2 font-medium">Number</th>
              <th class="px-2 py-2 font-medium">Issue</th>
              <th class="px-2 py-2 font-medium">Buyer</th>
              <th class="px-2 py-2 font-medium">Format</th>
              <th class="px-2 py-2 font-medium">Status</th>
              <th class="px-2 py-2 font-medium">Gross</th>
              <th class="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="!invoices.length">
              <td colspan="7" class="px-2 py-4 text-gray-600 dark:text-gray-400">
                No invoices yet.
              </td>
            </tr>
            <tr
              v-for="invoice in invoices"
              :key="invoice.id"
              class="border-b border-gray-100 text-gray-900 dark:border-gray-800 dark:text-white"
            >
              <td class="px-2 py-2 font-mono text-xs">{{ invoice.invoiceNumber }}</td>
              <td class="px-2 py-2">{{ invoice.issueDate }}</td>
              <td class="px-2 py-2">
                <div>{{ invoice.buyerName || invoice.buyerEmail || '—' }}</div>
                <div class="text-xs text-gray-600 dark:text-gray-400">
                  {{ invoice.buyerVatId || invoice.buyerCountry || '' }}
                </div>
              </td>
              <td class="px-2 py-2">{{ invoice.format }} / {{ invoice.routing }}</td>
              <td class="px-2 py-2">{{ invoice.status }}</td>
              <td class="px-2 py-2">
                {{ formatMoney(invoice.grossAmountCents, invoice.currency) }}
              </td>
              <td class="px-2 py-2">
                <button
                  type="button"
                  class="text-blue-600 hover:underline dark:text-blue-400"
                  @click="openInvoice(invoice.id)"
                >
                  View
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="selectedInvoice"
        class="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-gray-900 dark:text-white">
              {{ selectedInvoice.invoice.invoiceNumber }}
            </h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ selectedInvoice.invoice.status }}
              ·
              {{ selectedInvoice.invoice.peppolTransmissionId || 'no transmission id' }}
            </p>
            <p
              v-if="selectedInvoice.invoice.peppolTransmissionId?.startsWith('stub:')"
              class="mt-1 text-sm text-amber-800 dark:text-amber-200"
            >
              Stub transmission — not delivered to a Peppol AP or ISDOC recipient. Status
              <code class="text-xs">stub_sent</code>
              is not legal proof of delivery.
            </p>
            <p
              v-if="selectedInvoice.invoice.format === 'isdoc'"
              class="mt-1 text-sm text-amber-800 dark:text-amber-200"
            >
              ISDOC skeleton — not XSD-validated or digitally signed. Not yet legally compliant for
              CZ e-invoice delivery.
            </p>
            <p
              v-else-if="selectedInvoice.invoice.format === 'peppol_ubl'"
              class="mt-1 text-sm text-amber-800 dark:text-amber-200"
            >
              Peppol UBL skeleton — transmission may be stubbed until an Access Point is configured.
            </p>
            <p
              v-if="selectedInvoice.invoice.errorMessage"
              class="mt-1 text-sm text-red-700 dark:text-red-300"
            >
              {{ selectedInvoice.invoice.errorMessage }}
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
            @click="selectedInvoice = null"
          >
            Close
          </button>
        </div>
        <pre
          class="max-h-96 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-100"
        >{{ selectedInvoice.xmlPreview || '(no XML stored)' }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  type SellerForm = {
    legalName: string;
    vatId: string;
    companyId: string;
    addressLine1: string;
    addressCity: string;
    addressPostalCode: string;
    addressCountry: string;
    jurisdiction: 'SK' | 'CZ';
    peppolParticipantId: string;
    peppolSchemeId: string;
  };

  type PeppolForm = {
    accessPointProvider: string;
    accessPointApiUrl: string;
    accessPointSenderId: string;
  };

  type InvoiceRow = {
    id: string;
    invoiceNumber: string;
    issueDate: string;
    currency: string;
    grossAmountCents: number;
    buyerName: string | null;
    buyerEmail: string | null;
    buyerVatId: string | null;
    buyerCountry: string | null;
    format: string;
    routing: string;
    status: string;
    peppolTransmissionId?: string | null;
    errorMessage?: string | null;
  };

  const config = useRuntimeConfig();
  const apiUrl = computed(() => String(config.public.apiUrl || '').replace(/\/$/, ''));
  const { authHeader, isAdmin } = useAuth();

  const subTabs = [
    { id: 'settings' as const, label: 'Settings' },
    { id: 'invoices' as const, label: 'Invoices' },
  ];
  const activeSubTab = ref<'settings' | 'invoices'>('settings');
  const loading = ref(true);
  const saving = ref(false);
  const message = ref('');
  const messageOk = ref(true);
  const statusFilter = ref('');
  const invoices = ref<InvoiceRow[]>([]);
  const selectedInvoice = ref<{ invoice: InvoiceRow; xmlPreview: string | null } | null>(null);
  const peppolApiKeyConfigured = ref(false);
  const legalTimeline = reactive({
    skMandatoryB2bDate: '2027-01-01',
    skVoluntaryFrom: '2026-05-15',
    czB2bMandate: 'none_announced',
    euCrossBorderViDA: '2030-07-01',
  });

  const form = reactive({
    enabled: false,
    skVoluntaryEnabled: false,
    isdocEnabled: true,
    b2cMode: 'pdf_archive' as 'pdf_archive' | 'none',
    invoicePrefix: 'VMP',
    deliveryMode: 'stub' as 'stub' | 'live',
    czElectronicConsentRef: 'VMP-CZ-B2B-ELECTRONIC-CONSENT',
    seller: {
      legalName: '',
      vatId: '',
      companyId: '',
      addressLine1: '',
      addressCity: '',
      addressPostalCode: '',
      addressCountry: 'SK',
      jurisdiction: 'SK' as 'SK' | 'CZ',
      peppolParticipantId: '',
      peppolSchemeId: '9935',
    } satisfies SellerForm,
    peppol: {
      accessPointProvider: '',
      accessPointApiUrl: '',
      accessPointSenderId: '',
    } satisfies PeppolForm,
  });

  const messageClass = computed(() =>
    messageOk.value
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  );

  function formatMoney(cents: number, currency: string) {
    const amount = (Number(cents) || 0) / 100;
    return `${amount.toFixed(2)} ${String(currency || '').toUpperCase()}`;
  }

  async function loadSettings() {
    const res = await fetch(`${apiUrl.value}/api/admin/einvoicing/settings`, {
      headers: { ...authHeader() },
    });
    if (!res.ok) throw new Error(`Settings HTTP ${res.status}`);
    const data = await res.json();
    form.enabled = Boolean(data.enabled);
    form.skVoluntaryEnabled = Boolean(data.skVoluntaryEnabled);
    form.isdocEnabled = Boolean(data.isdocEnabled);
    form.b2cMode = data.b2cMode === 'none' ? 'none' : 'pdf_archive';
    form.invoicePrefix = String(data.invoicePrefix || 'VMP');
    form.deliveryMode = data.deliveryMode === 'live' ? 'live' : 'stub';
    form.czElectronicConsentRef = String(
      data.czElectronicConsentRef || 'VMP-CZ-B2B-ELECTRONIC-CONSENT',
    );
    Object.assign(form.seller, data.seller || {});
    Object.assign(form.peppol, data.peppol || {});
    peppolApiKeyConfigured.value = Boolean(data.peppol?.apiKeyConfigured);
    Object.assign(legalTimeline, data.legalTimeline || {});
  }

  async function loadInvoices() {
    try {
      const qs = statusFilter.value ? `?status=${encodeURIComponent(statusFilter.value)}` : '';
      const res = await fetch(`${apiUrl.value}/api/admin/einvoicing/invoices${qs}`, {
        headers: { ...authHeader() },
      });
      if (!res.ok) throw new Error(`Invoices HTTP ${res.status}`);
      const data = await res.json();
      invoices.value = Array.isArray(data.invoices) ? data.invoices : [];
      message.value = '';
      messageOk.value = true;
    } catch (err) {
      message.value = `Failed to load invoices: ${err instanceof Error ? err.message : String(err)}`;
      messageOk.value = false;
    }
  }

  async function openInvoice(id: string) {
    const res = await fetch(
      `${apiUrl.value}/api/admin/einvoicing/invoices/${encodeURIComponent(id)}`,
      {
        headers: { ...authHeader() },
      },
    );
    if (!res.ok) {
      message.value = `Failed to load invoice (${res.status})`;
      messageOk.value = false;
      return;
    }
    const data = await res.json();
    selectedInvoice.value = {
      invoice: data.invoice,
      xmlPreview: data.xmlPreview ?? null,
    };
  }

  async function saveSettings() {
    if (!isAdmin.value) return;
    saving.value = true;
    message.value = '';
    try {
      const res = await fetch(`${apiUrl.value}/api/admin/einvoicing/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          enabled: form.enabled,
          skVoluntaryEnabled: form.skVoluntaryEnabled,
          isdocEnabled: form.isdocEnabled,
          b2cMode: form.b2cMode,
          invoicePrefix: form.invoicePrefix,
          deliveryMode: form.deliveryMode,
          czElectronicConsentRef: form.czElectronicConsentRef,
          seller: { ...form.seller },
          peppol: { ...form.peppol },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      message.value = 'Settings saved.';
      messageOk.value = true;
      await loadSettings();
    } catch (err) {
      message.value = err instanceof Error ? err.message : String(err);
      messageOk.value = false;
    } finally {
      saving.value = false;
    }
  }

  async function bootstrap() {
    loading.value = true;
    message.value = '';
    try {
      await loadSettings();
      await loadInvoices();
    } catch (err) {
      message.value = err instanceof Error ? err.message : String(err);
      messageOk.value = false;
    } finally {
      loading.value = false;
    }
  }

  watch(activeSubTab, (tab) => {
    if (tab === 'invoices') void loadInvoices();
  });

  onMounted(() => {
    void bootstrap();
  });
</script>
