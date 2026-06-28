<template>
  <div class="cms-rich-text" v-html="html" />
</template>

<script setup lang="ts">
import type { CmsRichTextDocument } from '@vmp/shared'

const props = defineProps<{
  content: CmsRichTextDocument
}>()

const html = ref('')

async function loadHtml() {
  const { renderCmsRichTextHtml } = await import('~/utils/cmsRichTextRender')
  html.value = await renderCmsRichTextHtml(props.content)
}

await loadHtml()

watch(() => props.content, () => { void loadHtml() })
</script>
