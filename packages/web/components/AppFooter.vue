<template>
  <footer
    v-if="hasFooter"
    class="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 mt-auto"
  >
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <nav v-if="links.length" aria-label="Footer">
        <ul class="flex flex-wrap gap-x-6 gap-y-2">
          <li v-for="link in links" :key="link.id">
            <NuxtLink
              :to="`/${link.slug}`"
              class="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              {{ link.title }}
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <div v-if="content.length" class="text-sm text-gray-600 dark:text-gray-400">
        <CmsBlockRenderer :blocks="content" :image-urls="imageUrls" />
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import type { CmsBlock, CmsImageBlock } from '@vmp/shared'

type FooterLink = {
  id: string
  title: string
  slug: string
}

const config = useRuntimeConfig()
const apiUrl = String(config.public.apiUrl || '').replace(/\/$/, '')

const { data } = await useAsyncData('site-footer', async () => {
  try {
    const res = await fetch(`${apiUrl}/api/site-footer`)
    if (!res.ok) return { content: [] as CmsBlock[], links: [] as FooterLink[] }
    return await res.json() as { content: CmsBlock[]; links: FooterLink[] }
  } catch {
    return { content: [] as CmsBlock[], links: [] as FooterLink[] }
  }
})

const content = computed(() => Array.isArray(data.value?.content) ? data.value!.content : [])
const links = computed(() => Array.isArray(data.value?.links) ? data.value!.links : [])
const hasFooter = computed(() => content.value.length > 0 || links.value.length > 0)

const imageIds = computed(() =>
  content.value
    .filter((block): block is CmsImageBlock => block.type === 'image')
    .map((block) => block.imageId),
)

const imageUrls = ref<Record<string, string>>({})

async function loadImageUrls() {
  const urls: Record<string, string> = {}
  await Promise.all(
    imageIds.value.map(async (id) => {
      try {
        const res = await $fetch<{ media: { url?: string } }>(`${apiUrl}/api/cms/media/${id}`)
        if (res.media?.url) urls[id] = res.media.url
      } catch {
        // ignore missing media
      }
    }),
  )
  imageUrls.value = urls
}

watch(imageIds, () => { void loadImageUrls() }, { immediate: true })
</script>

<style scoped>
:deep(.cms-blocks) {
  @apply space-y-4;
}
:deep(.cms-rich-text p) {
  @apply text-sm text-gray-600 dark:text-gray-400 leading-relaxed;
}
</style>
