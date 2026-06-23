<template>
  <div class="cms-blocks space-y-10">
    <template v-for="(block, index) in blocks" :key="index">
      <section
        v-if="block.type === 'rich_text'"
        class="cms-rich-text prose prose-gray dark:prose-invert max-w-none scroll-mt-24"
        :class="sectionClass(block)"
        v-html="renderRichText(block.content)"
      />

      <figure v-else-if="block.type === 'image'" class="space-y-2">
        <img
          v-if="imageUrls[block.imageId]"
          :src="imageUrls[block.imageId]"
          :alt="block.caption || ''"
          class="w-full rounded-lg border border-gray-200 dark:border-gray-800"
          loading="lazy"
        />
        <figcaption
          v-if="block.caption"
          class="text-sm text-gray-500 dark:text-gray-400 text-center"
        >
          {{ block.caption }}
        </figcaption>
      </figure>

      <div
        v-else-if="block.type === 'callout'"
        class="rounded-lg border px-4 py-3 text-sm leading-relaxed"
        :class="calloutClass(block.variant)"
      >
        <div class="cms-rich-text prose prose-sm dark:prose-invert max-w-none" v-html="renderRichText(block.content)" />
      </div>

      <hr
        v-else-if="block.type === 'divider'"
        class="border-gray-200 dark:border-gray-800"
      >

      <div
        v-else-if="block.type === 'table'"
        class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
      >
        <table class="min-w-full text-sm text-left">
          <thead class="bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
            <tr>
              <th
                v-for="column in block.columns"
                :key="column"
                scope="col"
                class="px-3 py-2 font-semibold"
              >
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
            <tr
              v-for="(row, rowIndex) in block.rows"
              :key="rowIndex"
              class="text-gray-600 dark:text-gray-300"
            >
              <td
                v-for="(key, colIndex) in block.columnKeys"
                :key="`${rowIndex}-${colIndex}`"
                class="px-3 py-2"
                :class="colIndex === 0 ? 'font-mono text-xs' : ''"
              >
                {{ row[key] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CmsBlock, CmsCalloutVariant, CmsRichTextDocument } from '@vmp/shared'
import { renderCmsRichTextHtml } from '~/utils/cmsRichText'

const props = defineProps<{
  blocks: CmsBlock[]
  imageUrls?: Record<string, string>
}>()

const imageUrls = computed(() => props.imageUrls ?? {})

function renderRichText(content: CmsRichTextDocument) {
  return renderCmsRichTextHtml(content)
}

function calloutClass(variant: CmsCalloutVariant) {
  if (variant === 'warning') {
    return 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100'
  }
  if (variant === 'error') {
    return 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100'
  }
  return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100'
}

function sectionClass(block: CmsBlock) {
  if (block.type !== 'rich_text') return ''
  const content = block.content as { content?: Array<{ type?: string; attrs?: { level?: number } }> }
  const first = content?.content?.[0]
  if (first?.type === 'heading' && first.attrs?.level === 2) {
    return 'space-y-3'
  }
  return ''
}
</script>

<style scoped>
.cms-rich-text :deep(h2) {
  @apply text-xl font-semibold text-gray-900 dark:text-white;
}
.cms-rich-text :deep(h3) {
  @apply text-lg font-semibold text-gray-900 dark:text-white;
}
.cms-rich-text :deep(p) {
  @apply mt-3 text-gray-600 dark:text-gray-300 leading-relaxed;
}
.cms-rich-text :deep(p:first-child) {
  @apply mt-0;
}
.cms-rich-text :deep(ul) {
  @apply mt-3 list-disc pl-5 space-y-1 text-gray-600 dark:text-gray-300;
}
.cms-rich-text :deep(a) {
  @apply text-blue-600 dark:text-blue-400 hover:underline;
}
</style>
