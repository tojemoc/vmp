<template>
  <div class="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-950">
    <AppHeader />

    <main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
          {{ page.title }}
        </h1>
        <div
          v-if="introBlock"
          class="cms-intro cms-rich-text"
          v-html="introHtml"
        />
      </header>

      <article>
        <CmsBlockRenderer :blocks="bodyBlocks" :image-urls="imageUrls" />
      </article>

      <p class="mt-10 text-sm text-gray-500 dark:text-gray-400">
        <NuxtLink to="/" class="text-blue-600 dark:text-blue-400 hover:underline">
          {{ strings.backToHomepage }}
        </NuxtLink>
      </p>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { CmsBlock, CmsPage, CmsRichTextBlock, CmsRichTextDocument } from '@vmp/shared'
import { isCmsReservedSlug } from '~/utils/cmsReservedSlugs'
import { fetchCmsMediaUrls } from '~/utils/fetchCmsMediaUrls'

const route = useRoute()
const config = useRuntimeConfig()
const { strings } = useStrings()

const slug = computed(() => String(route.params.slug ?? ''))

if (isCmsReservedSlug(slug.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' })
}

const apiUrl = String(config.public.apiUrl || '').replace(/\/$/, '')

const { data, error } = await useFetch<{ page: CmsPage }>(
  () => `${apiUrl}/api/pages/${encodeURIComponent(slug.value)}`,
  { key: `cms-page-${slug.value}` },
)

if (error.value || !data.value?.page) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' })
}

const page = computed(() => data.value!.page)

function isIntroRichTextBlock(block: CmsBlock): block is CmsRichTextBlock {
  if (block.type !== 'rich_text') return false
  const nodes = (block.content as { content?: Array<{ type?: string }> })?.content ?? []
  return nodes.length > 0 && nodes.every((node) => node.type === 'paragraph')
}

const introBlock = computed(() => {
  const first = page.value.content[0]
  return first && isIntroRichTextBlock(first) ? first : null
})

const bodyBlocks = computed(() =>
  introBlock.value ? page.value.content.slice(1) : page.value.content,
)

const introHtml = ref('')

async function loadIntroHtml() {
  const block = introBlock.value
  if (!block) {
    introHtml.value = ''
    return
  }
  const { renderCmsRichTextHtml } = await import('~/utils/cmsRichTextRender')
  introHtml.value = await renderCmsRichTextHtml(block.content as CmsRichTextDocument)
}

await loadIntroHtml()
watch(introBlock, () => { void loadIntroHtml() })

const imageIds = computed(() =>
  page.value.content
    .filter((block): block is Extract<typeof block, { type: 'image' }> => block.type === 'image')
    .map((block) => block.imageId),
)

const imageUrls = ref<Record<string, string>>({})

async function loadImageUrls() {
  imageUrls.value = await fetchCmsMediaUrls(apiUrl, imageIds.value)
}

await loadImageUrls()

usePageSeo(
  computed(() => ({
    title: page.value.title,
    description: page.value.description ?? undefined,
  })),
)

const { acknowledgeNotice } = usePersonalDataNotice()

onMounted(() => {
  if (slug.value === 'personal-data') {
    acknowledgeNotice()
  }
})
</script>

<style scoped>
.cms-intro :deep(p) {
  @apply mt-4 text-gray-600 dark:text-gray-300 leading-relaxed;
}
.cms-intro :deep(p:first-child) {
  @apply mt-4;
}
</style>
