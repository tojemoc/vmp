<template>
  <div class="cms-rich-text text-gray-900 dark:text-white" v-html="renderedHtml" />
</template>

<script setup lang="ts">
  import type { CmsRichTextDocument } from '@vmp/shared';
  import { serializeCmsRichTextContent } from '~/utils/cmsRichTextHash';
  import { renderCmsRichTextHtml } from '~/utils/cmsRichTextRender';

  const props = defineProps<{
    content: CmsRichTextDocument;
  }>();

  // Render on the server and reuse the serialized HTML during hydration. Re-running
  // the async TipTap renderer on the client can produce different markup — or empty
  // HTML when its chunk fails to load — which breaks hydration. Sharing the server
  // output through the payload keeps SSR and the first client render identical.
  const { data: html } = await useAsyncData(
    `cms-rich-text-${serializeCmsRichTextContent(props.content)}`,
    async () => ({ html: await renderCmsRichTextHtml(props.content) }),
    { default: () => ({ html: '' }), watch: [() => props.content] },
  );

  const renderedHtml = computed(() => html.value?.html || '');
</script>
