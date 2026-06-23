<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">Pages</h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
        Create and publish content pages without code deployments.
      </p>
    </div>

    <div v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageClass">{{ message }}</div>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
        @click="startCreate"
      >
        New page
      </button>
      <button
        v-if="editing"
        type="button"
        class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="cancelEdit"
      >
        Back to list
      </button>
    </div>

    <!-- Page list -->
    <div v-if="!editing" class="space-y-3">
      <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="loadPages">
        Refresh
      </button>
      <div v-if="!pages.length" class="text-sm text-gray-500 dark:text-gray-400">No pages yet.</div>
      <div
        v-for="page in pages"
        :key="page.id"
        class="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
      >
        <div>
          <p class="font-medium text-gray-900 dark:text-white">{{ page.title }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">/{{ page.slug }}</p>
          <span
            class="inline-flex mt-1 px-2 py-0.5 rounded-full text-xs"
            :class="page.status === 'published'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'"
          >
            {{ page.status }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2 text-sm">
          <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline" @click="editPage(page)">Edit</button>
          <a
            v-if="page.status === 'published'"
            :href="`/${page.slug}`"
            target="_blank"
            rel="noopener noreferrer"
            class="text-gray-600 dark:text-gray-400 hover:underline"
          >View</a>
          <button
            v-if="page.status === 'draft'"
            type="button"
            class="text-emerald-600 dark:text-emerald-400 hover:underline"
            @click="publishPage(page.id)"
          >
            Publish
          </button>
          <button
            v-else
            type="button"
            class="text-amber-600 dark:text-amber-400 hover:underline"
            @click="unpublishPage(page.id)"
          >
            Unpublish
          </button>
          <button type="button" class="text-red-600 dark:text-red-400 hover:underline" @click="deletePage(page.id)">Delete</button>
        </div>
      </div>
    </div>

    <!-- Editor -->
    <div v-else class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4">
        <label class="block text-sm font-medium text-gray-900 dark:text-white">
          Title
          <input
            v-model="form.title"
            type="text"
            class="mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            @input="maybeAutoSlug"
          >
        </label>

        <label class="block text-sm font-medium text-gray-900 dark:text-white">
          Slug
          <input
            v-model="form.slug"
            type="text"
            class="mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm"
            @input="onSlugInput"
            @blur="normalizeSlugField"
          >
        </label>

        <label class="block text-sm font-medium text-gray-900 dark:text-white">
          SEO description
          <textarea
            v-model="form.description"
            rows="2"
            class="mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
          />
        </label>

        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium text-gray-900 dark:text-white">Content blocks</p>
            <div class="flex flex-wrap gap-1">
              <button type="button" class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800" @click="addBlock('rich_text')">+ Text</button>
              <button type="button" class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800" @click="pickImage">+ Image</button>
              <button type="button" class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800" @click="addBlock('callout')">+ Callout</button>
              <button type="button" class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800" @click="addBlock('divider')">+ Divider</button>
            </div>
          </div>

          <input ref="imageInputEl" type="file" accept="image/*" class="hidden" @change="onImageSelected">

          <div
            v-for="(block, index) in form.content"
            :key="index"
            class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ block.type }}</span>
              <div class="flex gap-2 text-xs">
                <button type="button" class="text-gray-600 dark:text-gray-400 hover:underline" :disabled="index === 0" @click="moveBlock(index, -1)">Up</button>
                <button type="button" class="text-gray-600 dark:text-gray-400 hover:underline" :disabled="index === form.content.length - 1" @click="moveBlock(index, 1)">Down</button>
                <button type="button" class="text-red-600 dark:text-red-400 hover:underline" @click="removeBlock(index)">Remove</button>
              </div>
            </div>

            <CmsRichTextEditor
              v-if="block.type === 'rich_text'"
              v-model="block.content"
            />

            <div v-else-if="block.type === 'callout'" class="space-y-2">
              <select
                v-model="block.variant"
                class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
              <CmsRichTextEditor v-model="block.content" />
            </div>

            <div v-else-if="block.type === 'image'" class="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <img
                v-if="previewImageUrls[block.imageId]"
                :src="previewImageUrls[block.imageId]"
                alt=""
                class="max-h-40 rounded border border-gray-200 dark:border-gray-700"
              >
              <input
                v-model="block.caption"
                type="text"
                placeholder="Caption (optional)"
                class="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
            </div>

            <div v-else-if="block.type === 'table'" class="text-xs text-gray-500 dark:text-gray-400">
              Table block (edit rows in JSON via API for now)
            </div>

            <p v-else-if="block.type === 'divider'" class="text-xs text-gray-500 dark:text-gray-400">Horizontal divider</p>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
            :disabled="saving"
            @click="savePage"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <button
            v-if="form.id && form.status === 'draft'"
            type="button"
            class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
            :disabled="saving"
            @click="saveAndPublish"
          >
            Save & publish
          </button>
          <button
            v-if="form.id"
            type="button"
            class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
            @click="loadPreview"
          >
            Refresh preview
          </button>
        </div>

        <details v-if="form.id" class="rounded-lg border border-gray-200 dark:border-gray-700">
          <summary class="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">Revision history</summary>
          <div class="px-4 pb-4 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            <button type="button" class="text-sm text-blue-600 dark:text-blue-400 hover:underline" @click="loadRevisions">Refresh revisions</button>
            <div v-if="!revisions.length" class="text-sm text-gray-500 dark:text-gray-400">No revisions yet.</div>
            <div
              v-for="revision in revisions"
              :key="revision.id"
              class="flex items-center justify-between gap-2 text-sm border-b border-gray-100 dark:border-gray-800 py-2"
            >
              <span class="text-gray-600 dark:text-gray-300">{{ new Date(revision.createdAt).toLocaleString() }}</span>
              <button type="button" class="text-blue-600 dark:text-blue-400 hover:underline" @click="restoreRevision(revision.id)">Restore</button>
            </div>
          </div>
        </details>
      </div>

      <div>
        <p class="text-sm font-medium text-gray-900 dark:text-white mb-2">Preview</p>
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-6 min-h-[24rem]">
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">{{ form.title || 'Untitled' }}</h1>
          <CmsBlockRenderer :blocks="form.content" :image-urls="previewImageUrls" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CmsBlock, CmsCalloutBlock, CmsImageBlock, CmsPage, CmsPageRevision, CmsRichTextBlock } from '@vmp/shared'
import { emptyTiptapDoc } from '~/utils/cmsRichText'
import { isCmsReservedSlug } from '~/utils/cmsReservedSlugs'

const config = useRuntimeConfig()
const { authHeader } = useAuth()

const apiUrl = String(config.public.apiUrl || '').replace(/\/$/, '')

const pages = ref<CmsPage[]>([])
const revisions = ref<CmsPageRevision[]>([])
const editing = ref(false)
const saving = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')
const slugTouched = ref(false)
const imageInputEl = ref<HTMLInputElement | null>(null)
const previewImageUrls = ref<Record<string, string>>({})

const form = reactive({
  id: '' as string | null,
  title: '',
  slug: '',
  description: '',
  status: 'draft' as 'draft' | 'published',
  content: [] as CmsBlock[],
})

const messageClass = computed(() =>
  messageTone.value === 'ok'
    ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100'
    : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-100',
)

function setMessage(text: string, tone: 'ok' | 'error' = 'ok') {
  message.value = text
  messageTone.value = tone
}

function slugify(input: string) {
  const slug = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return slug || 'untitled'
}

function onSlugInput() {
  slugTouched.value = true
}

function normalizeSlugField() {
  form.slug = slugify(form.slug)
}

function maybeAutoSlug() {
  if (!slugTouched.value) form.slug = slugify(form.title)
}

function newRichTextBlock(): CmsRichTextBlock {
  return { type: 'rich_text', content: emptyTiptapDoc() }
}

function newCalloutBlock(): CmsCalloutBlock {
  return { type: 'callout', variant: 'info', content: emptyTiptapDoc() }
}

function addBlock(type: CmsBlock['type']) {
  if (type === 'rich_text') form.content.push(newRichTextBlock())
  else if (type === 'callout') form.content.push(newCalloutBlock())
  else if (type === 'divider') form.content.push({ type: 'divider' })
}

function removeBlock(index: number) {
  form.content.splice(index, 1)
}

function moveBlock(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= form.content.length) return
  const item = form.content[index]
  if (!item) return
  form.content.splice(index, 1)
  form.content.splice(target, 0, item)
}

function resetForm() {
  form.id = null
  form.title = ''
  form.slug = ''
  form.description = ''
  form.status = 'draft'
  form.content = [newRichTextBlock()]
  slugTouched.value = false
  revisions.value = []
}

function startCreate() {
  resetForm()
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  resetForm()
}

function editPage(page: CmsPage) {
  form.id = page.id
  form.title = page.title
  form.slug = page.slug
  form.description = page.description ?? ''
  form.status = page.status
  form.content = JSON.parse(JSON.stringify(page.content)) as CmsBlock[]
  slugTouched.value = true
  editing.value = true
  void loadRevisions()
  void refreshPreviewImages()
}

async function loadPages() {
  try {
    const res = await $fetch<{ pages: CmsPage[] }>(`${apiUrl}/api/pages`, { headers: authHeader() })
    pages.value = res.pages
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Failed to load pages', 'error')
  }
}

async function savePage() {
  saving.value = true
  try {
    const payload = {
      title: form.title.trim(),
      slug: slugify(form.slug.trim()),
      description: form.description.trim() || null,
      status: form.status,
      content: form.content,
    }
    if (!payload.title || !payload.slug) throw new Error('Title and slug are required')
    if (isCmsReservedSlug(payload.slug)) {
      throw new Error(`Slug "${payload.slug}" is reserved and cannot be used for a CMS page`)
    }

    if (form.id) {
      const res = await $fetch<{ page: CmsPage }>(`${apiUrl}/api/pages/${form.id}`, {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: payload,
      })
      form.status = res.page.status
      setMessage('Page saved.')
      await loadPages()
      await loadRevisions()
    } else {
      const res = await $fetch<{ page: CmsPage }>(`${apiUrl}/api/pages`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: payload,
      })
      form.id = res.page.id
      form.status = res.page.status
      setMessage('Page created.')
      await loadPages()
    }
    await refreshPreviewImages()
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Failed to save page', 'error')
  } finally {
    saving.value = false
  }
}

async function saveAndPublish() {
  await savePage()
  if (!form.id) return
  await publishPage(form.id)
}

async function publishPage(id: string) {
  try {
    await $fetch(`${apiUrl}/api/pages/${id}/publish`, { method: 'POST', headers: authHeader() })
    if (form.id === id) form.status = 'published'
    setMessage('Page published.')
    await loadPages()
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Failed to publish', 'error')
  }
}

async function unpublishPage(id: string) {
  try {
    await $fetch(`${apiUrl}/api/pages/${id}/unpublish`, { method: 'POST', headers: authHeader() })
    if (form.id === id) form.status = 'draft'
    setMessage('Page unpublished.')
    await loadPages()
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Failed to unpublish', 'error')
  }
}

async function deletePage(id: string) {
  if (!confirm('Delete this page?')) return
  try {
    await $fetch(`${apiUrl}/api/pages/${id}`, { method: 'DELETE', headers: authHeader() })
    if (form.id === id) cancelEdit()
    setMessage('Page deleted.')
    await loadPages()
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Failed to delete', 'error')
  }
}

async function loadRevisions() {
  if (!form.id) return
  try {
    const res = await $fetch<{ revisions: CmsPageRevision[] }>(`${apiUrl}/api/pages/${form.id}/revisions`, {
      headers: authHeader(),
    })
    revisions.value = res.revisions
  } catch {
    revisions.value = []
  }
}

async function restoreRevision(revisionId: string) {
  if (!form.id || !confirm('Restore this revision? Current content will be replaced.')) return
  try {
    const res = await $fetch<{ page: CmsPage }>(`${apiUrl}/api/pages/${form.id}/revisions/${revisionId}/restore`, {
      method: 'POST',
      headers: authHeader(),
    })
    editPage(res.page)
    setMessage('Revision restored.')
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Failed to restore revision', 'error')
  }
}

function pickImage() {
  imageInputEl.value?.click()
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const formData = new FormData()
  formData.append('image', file)
  try {
    const res = await $fetch<{ media: { id: string; url?: string } }>(`${apiUrl}/api/admin/cms/media`, {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    })
    const block: CmsImageBlock = { type: 'image', imageId: res.media.id, caption: '' }
    form.content.push(block)
    if (res.media.url) previewImageUrls.value[res.media.id] = res.media.url
    setMessage('Image uploaded.')
  } catch (err: unknown) {
    setMessage(err instanceof Error ? err.message : 'Image upload failed', 'error')
  }
}

async function refreshPreviewImages() {
  const ids = form.content
    .filter((b): b is CmsImageBlock => b.type === 'image')
    .map((b) => b.imageId)
  const urls: Record<string, string> = { ...previewImageUrls.value }
  await Promise.all(ids.map(async (id) => {
    if (urls[id]) return
    try {
      const res = await $fetch<{ media: { url?: string } }>(`${apiUrl}/api/cms/media/${id}`)
      if (res.media?.url) urls[id] = res.media.url
    } catch { /* ignore */ }
  }))
  previewImageUrls.value = urls
}

function loadPreview() {
  void refreshPreviewImages()
}

watch(() => form.slug, () => { slugTouched.value = true })

onMounted(() => {
  void loadPages()
})
</script>
