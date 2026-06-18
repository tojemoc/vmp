<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">Newsletter</h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Compose campaigns, manage drafts, and view sent campaigns.</p>
    </div>

    <div v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageClass">{{ message }}</div>

    <div class="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        type="button"
        class="px-3 py-1.5 rounded-lg text-sm font-medium"
        :class="activeSubTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
        @click="activeSubTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Compose -->
    <div v-if="activeSubTab === 'compose'" class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4">
        <details class="rounded-lg border border-gray-200 dark:border-gray-700">
          <summary class="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">⚙ Settings</summary>
          <div class="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
            <label class="block text-sm text-gray-700 dark:text-gray-300">
              Brevo subscriber list ID
              <input v-model="listId" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </label>
            <label class="block text-sm text-gray-700 dark:text-gray-300">
              Campaign sender email
              <input v-model="senderEmail" type="email" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </label>
            <label class="block text-sm text-gray-700 dark:text-gray-300">
              Sender display name
              <input v-model="senderName" type="text" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </label>
            <label class="block text-sm text-gray-700 dark:text-gray-300">
              Campaign list refresh interval (ms)
              <input v-model.number="pollIntervalMs" type="number" min="60000" max="86400000" step="60000" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </label>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="settingsSaving" @click="saveSettings">
                {{ settingsSaving ? 'Saving…' : 'Save settings' }}
              </button>
              <button type="button" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="syncing" @click="syncRecipients">
                {{ syncing ? 'Syncing…' : 'Sync recipients' }}
              </button>
            </div>
          </div>
        </details>

        <label class="block text-sm font-medium text-gray-900 dark:text-white">
          Subject
          <input v-model="subject" type="text" class="mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>

        <div class="flex items-center gap-2 text-sm">
          <span class="text-gray-600 dark:text-gray-400">Body format:</span>
          <button type="button" class="px-2 py-1 rounded" :class="bodyMode === 'html' ? 'bg-blue-600 text-white' : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'" @click="setBodyMode('html')">HTML</button>
          <button type="button" class="px-2 py-1 rounded" :class="bodyMode === 'markdown' ? 'bg-blue-600 text-white' : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'" @click="setBodyMode('markdown')">Markdown</button>
        </div>

        <label class="block text-sm font-medium text-gray-900 dark:text-white">
          Template
          <select v-model="templateId" class="mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" @change="applyTemplate">
            <option value="">No template</option>
            <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
          </select>
        </label>

        <label class="block text-sm font-medium text-gray-900 dark:text-white">
          Body
          <textarea v-model="body" rows="14" class="mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm min-h-[12rem]" />
        </label>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50" :disabled="draftSaving" @click="saveDraft">
            {{ draftSaving ? 'Saving…' : 'Save as draft' }}
          </button>
          <div class="relative">
            <button type="button" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="scheduling" @click="showSchedulePicker = !showSchedulePicker">
              Schedule
            </button>
            <div v-if="showSchedulePicker" class="absolute z-10 mt-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg space-y-2 min-w-[16rem]">
              <input v-model="scheduleAtLocal" type="datetime-local" class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm" />
              <button type="button" class="w-full px-3 py-1.5 rounded bg-amber-600 text-white text-sm font-semibold disabled:opacity-50" :disabled="scheduling || !scheduleAtLocal" @click="scheduleCampaign">
                Confirm schedule
              </button>
            </div>
          </div>
          <button type="button" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50" :disabled="sending" @click="sendNow">
            {{ sending ? 'Sending…' : 'Send now' }}
          </button>
        </div>
      </div>

      <div>
        <p class="text-sm font-medium text-gray-900 dark:text-white mb-2">Preview</p>
        <iframe
          v-if="previewHtml.trim()"
          title="Newsletter preview"
          class="w-full min-h-[24rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950"
          sandbox=""
          referrerpolicy="no-referrer"
          :srcdoc="previewSrcdoc"
        />
        <div v-else class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 min-h-[24rem] flex items-center justify-center text-sm text-gray-400">
          Preview appears here.
        </div>
      </div>
    </div>

    <!-- Drafts -->
    <div v-else-if="activeSubTab === 'drafts'" class="space-y-3">
      <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="loadDrafts">Refresh drafts</button>
      <div v-if="!drafts.length" class="text-sm text-gray-500 dark:text-gray-400">No drafts yet.</div>
      <div v-for="draft in drafts" :key="draft.id" class="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="font-medium text-gray-900 dark:text-white">{{ draft.name }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ draft.subject }}</p>
          <span v-if="draft.scheduledAt" class="inline-flex mt-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Scheduled</span>
        </div>
        <div class="flex gap-2 text-sm">
          <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline" @click="loadDraftIntoCompose(draft)">Edit</button>
          <button type="button" class="text-emerald-600 dark:text-emerald-400 hover:underline" @click="sendDraftNow(draft)">Send now</button>
          <button type="button" class="text-red-600 dark:text-red-400 hover:underline" @click="deleteDraft(draft.id)">Delete</button>
        </div>
      </div>
    </div>

    <!-- Archive -->
    <div v-else class="space-y-3">
      <p class="text-xs text-gray-500 dark:text-gray-400">
        <span v-if="lastCampaignsOkAt">Last refreshed: {{ new Date(lastCampaignsOkAt).toLocaleString() }}</span>
        <span v-if="lastCampaignsError" class="text-red-600 dark:text-red-400"> · {{ lastCampaignsError }}</span>
      </p>
      <table class="min-w-full text-sm">
        <thead>
          <tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th class="py-2 pr-4">Subject</th>
            <th class="py-2 pr-4">Sent</th>
            <th class="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in campaigns" :key="c.id" class="border-b border-gray-100 dark:border-gray-800">
            <td class="py-2 pr-4 text-gray-900 dark:text-white">{{ c.subject || c.name }}</td>
            <td class="py-2 pr-4 text-gray-600 dark:text-gray-400">{{ c.sentDate || '—' }}</td>
            <td class="py-2 text-gray-600 dark:text-gray-400">{{ c.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { renderMarkdownToHtml } from '~/utils/markdown'

interface NewsletterTemplate {
  id: string
  name: string
  subject: string
  html_body: string
}

interface NewsletterDraft {
  id: string
  name: string
  subject: string
  htmlBody: string
  scheduledAt: string | null
}

interface NewsletterCampaign {
  id: number | string
  name?: string
  subject?: string
  status?: string
  sentDate?: string
}

const config = useRuntimeConfig()
const { authHeader } = useAuth()

const subTabs = [
  { id: 'compose', label: 'Compose' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'archive', label: 'Archive' },
] as const

type SubTabId = typeof subTabs[number]['id']

const activeSubTab = ref<SubTabId>('compose')
const message = ref('')
const messageClass = ref('')

const listId = ref('')
const senderEmail = ref('')
const senderName = ref('')
const pollIntervalMs = ref(600_000)
const settingsSaving = ref(false)
const syncing = ref(false)

const subject = ref('')
const body = ref('')
const bodyMode = ref<'html' | 'markdown'>('html')
const templateId = ref('')
const templates = ref<NewsletterTemplate[]>([])
const drafts = ref<NewsletterDraft[]>([])
const campaigns = ref<NewsletterCampaign[]>([])
const editingDraftId = ref<string | null>(null)

async function loadCampaigns() {
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/campaigns`, { headers: authHeader() })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  campaigns.value = data.campaigns || []
}

const sending = ref(false)
const draftSaving = ref(false)
const scheduling = ref(false)
const showSchedulePicker = ref(false)
const scheduleAtLocal = ref('')

const BODY_MODE_KEY = 'vmp-newsletter-body-mode'

const previewHtml = computed(() => {
  const raw = body.value
  if (!raw.trim()) return ''
  return bodyMode.value === 'markdown' ? renderMarkdownToHtml(raw) : raw
})

const previewSrcdoc = ref('')
let previewTimer: ReturnType<typeof setTimeout> | null = null
watch(previewHtml, (html) => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewSrcdoc.value = html
  }, 300)
}, { immediate: true })

const isActive = computed(() => true)

const { lastCampaignsOkAt, lastCampaignsError } = useAdminNewsletterPolling({
  pollIntervalMs,
  isActive: computed(() => activeSubTab.value === 'archive'),
  isAdmin: ref(true),
  loadCampaigns: loadCampaigns,
})

function setBodyMode(mode: 'html' | 'markdown') {
  bodyMode.value = mode
  if (import.meta.client) localStorage.setItem(BODY_MODE_KEY, mode)
}

async function loadSettings() {
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/settings`, { headers: authHeader() })
  if (!res.ok) return
  const data = await res.json()
  listId.value = data.brevoSubscriberListId != null ? String(data.brevoSubscriberListId) : ''
  senderEmail.value = data.brevoCampaignSenderEmail ?? ''
  senderName.value = data.brevoCampaignSenderName ?? ''
  const poll = Number(data.brevoNewsletterPollIntervalMs)
  pollIntervalMs.value = Number.isFinite(poll) && poll >= 60_000 ? poll : 600_000
}

async function saveSettings() {
  settingsSaving.value = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        brevoSubscriberListId: listId.value,
        brevoCampaignSenderEmail: senderEmail.value,
        brevoCampaignSenderName: senderName.value,
        brevoNewsletterPollIntervalMs: pollIntervalMs.value,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    message.value = 'Settings saved.'
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Save failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    settingsSaving.value = false
  }
}

async function syncRecipients() {
  syncing.value = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/sync`, { method: 'POST', headers: authHeader() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    message.value = `Sync complete. Recipients synced: ${data.synced}`
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Sync failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    syncing.value = false
  }
}

async function loadTemplates() {
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/templates`, { headers: authHeader() })
  if (!res.ok) return
  const data = await res.json()
  templates.value = data.templates || []
}

async function loadDrafts() {
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/drafts`, { headers: authHeader() })
  if (!res.ok) return
  const data = await res.json()
  drafts.value = data.drafts || []
}

function applyTemplate() {
  const tpl = templates.value.find((t) => t.id === templateId.value)
  if (!tpl) return
  subject.value = tpl.subject
  body.value = tpl.html_body
  bodyMode.value = 'html'
}

function htmlBodyForApi(): string {
  return bodyMode.value === 'markdown' ? renderMarkdownToHtml(body.value) : body.value
}

async function saveDraft() {
  const name = subject.value.trim() || `Draft ${new Date().toLocaleString()}`
  const htmlBody = htmlBodyForApi()
  if (!htmlBody.trim()) {
    message.value = 'Body is required.'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  draftSaving.value = true
  try {
    const url = editingDraftId.value
      ? `${config.public.apiUrl}/api/admin/newsletter/drafts/${editingDraftId.value}`
      : `${config.public.apiUrl}/api/admin/newsletter/drafts`
    const res = await fetch(url, {
      method: editingDraftId.value ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name, subject: subject.value, htmlBody }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    if (data.draft?.id) editingDraftId.value = data.draft.id
    message.value = 'Draft saved.'
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadDrafts()
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Save failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    draftSaving.value = false
  }
}

function buildDedupeKey(): string {
  const base = `${subject.value}:${htmlBodyForApi().length}`
  return `admin-send:${base.slice(0, 200)}`
}

async function sendNow() {
  const htmlBody = htmlBodyForApi()
  if (!subject.value.trim() || !htmlBody.trim()) {
    message.value = 'Subject and body are required.'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
    return
  }
  sending.value = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ subject: subject.value, htmlBody, dedupeKey: buildDedupeKey() }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    message.value = data.idempotent ? 'Campaign already sent (idempotent).' : 'Campaign sent.'
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    await loadCampaigns()
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Send failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    sending.value = false
  }
}

async function scheduleCampaign() {
  const htmlBody = htmlBodyForApi()
  if (!subject.value.trim() || !htmlBody.trim() || !scheduleAtLocal.value) return
  const scheduledAt = new Date(scheduleAtLocal.value).toISOString()
  scheduling.value = true
  try {
    const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        draftId: editingDraftId.value || undefined,
        subject: subject.value,
        htmlBody,
        scheduledAt,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    message.value = `Scheduled for ${scheduleAtLocal.value}.`
    messageClass.value = 'border-green-300 bg-green-50 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
    showSchedulePicker.value = false
    await loadDrafts()
  } catch (e: unknown) {
    message.value = e instanceof Error ? e.message : 'Schedule failed'
    messageClass.value = 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200'
  } finally {
    scheduling.value = false
  }
}

function loadDraftIntoCompose(draft: NewsletterDraft) {
  editingDraftId.value = draft.id
  subject.value = draft.subject
  body.value = draft.htmlBody
  bodyMode.value = 'html'
  activeSubTab.value = 'compose'
}

async function sendDraftNow(draft: NewsletterDraft) {
  subject.value = draft.subject
  body.value = draft.htmlBody
  bodyMode.value = 'html'
  editingDraftId.value = draft.id
  await sendNow()
}

async function deleteDraft(id: string) {
  const res = await fetch(`${config.public.apiUrl}/api/admin/newsletter/drafts/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (res.ok) await loadDrafts()
}

onMounted(() => {
  if (import.meta.client) {
    const stored = localStorage.getItem(BODY_MODE_KEY)
    if (stored === 'markdown' || stored === 'html') bodyMode.value = stored
  }
  void loadSettings()
  void loadTemplates()
  void loadDrafts()
  void loadCampaigns().catch(() => {})
})
</script>
