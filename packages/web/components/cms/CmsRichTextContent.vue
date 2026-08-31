<template>
  <div class="cms-rich-text text-gray-900 dark:text-white" v-html="html" />
</template>

<script setup lang="ts">
  import type { CmsRichTextDocument } from '@vmp/shared';
  import { renderCmsRichTextHtml } from '~/utils/cmsRichTextRender';

  const props = defineProps<{
    content: CmsRichTextDocument;
  }>();

  const html = ref('');

  async function loadHtml() {
    html.value = await renderCmsRichTextHtml(props.content);
  }

  await loadHtml();

  watch(
    () => props.content,
    () => {
      void loadHtml();
    },
  );
</script>
