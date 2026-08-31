<template>
  <div class="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-950">
    <AppHeader />

    <main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
          {{ page.title }}
        </h1>
        <div v-if="introBlock" class="cms-intro cms-rich-text" v-html="introHtml" />
      </header>

      <article>
        <CmsBlockRenderer :blocks="bodyBlocks" :image-urls="imageUrls" />
      </article>

      <section
        v-if="isPersonalDataPage"
        class="mt-10 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-3"
      >
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
          {{ strings.personalDataContactTitle }}
        </h2>
        <template v-if="supportEmail">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ strings.personalDataContactIntro }}
          </p>
          <p>
            <a
              :href="supportMailto"
              class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all"
            >
              {{ supportEmail }}
            </a>
          </p>
        </template>
        <p v-else class="text-sm text-amber-800 dark:text-amber-200">
          {{ strings.personalDataContactUnavailable }}
        </p>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ strings.personalDataContactAccountHint }}
          <NuxtLink to="/account" class="text-blue-600 dark:text-blue-400 hover:underline">
            {{ strings.yourAccount }}
          </NuxtLink>
        </p>
      </section>

      <p class="mt-10 text-sm text-gray-500 dark:text-gray-400">
        <NuxtLink to="/" class="text-blue-600 dark:text-blue-400 hover:underline">
          {{ strings.backToHomepage }}
        </NuxtLink>
      </p>
    </main>
  </div>
</template>

<script setup lang="ts">
  import type { CmsBlock, CmsPage, CmsRichTextBlock, CmsRichTextDocument } from '@vmp/shared';
  import { isCmsReservedSlug } from '~/utils/cmsReservedSlugs';
  import { renderCmsRichTextHtml } from '~/utils/cmsRichTextRender';
  import { fetchCmsMediaUrls } from '~/utils/fetchCmsMediaUrls';
  import { httpStatusFromError } from '~/utils/httpErrorStatus';

  const route = useRoute();
  const config = useRuntimeConfig();
  const { strings } = useStrings();

  const slug = computed(() => String(route.params.slug ?? ''));
  const isPersonalDataPage = computed(() => slug.value === 'personal-data');

  const { siteSettings } = useSiteSettings();
  const supportEmail = computed(() => siteSettings.value.supportEmail?.trim() || '');
  const supportMailto = computed(() =>
    supportEmail.value ? `mailto:${supportEmail.value}` : '',
  );

  function throwPageNotFound(): never {
    if (import.meta.server) {
      setResponseStatus(404);
    }
    throw createError({ statusCode: 404, statusMessage: 'Page not found' });
  }

  if (isCmsReservedSlug(slug.value)) {
    throwPageNotFound();
  }

  const apiUrl = String(config.public.apiUrl || '').replace(/\/$/, '');

  const { data, error } = await useFetch<{ page: CmsPage }>(
    () => `${apiUrl}/api/pages/${encodeURIComponent(slug.value)}`,
    { key: `cms-page-${slug.value}` },
  );

  // A failed CMS fetch is not the same thing as a missing page. Only the API
  // answering 4xx means this slug cannot resolve to a page; a timeout or a 5xx
  // means the API is unhealthy, and replying 404 there tells visitors the
  // content was deleted and invites search engines to drop a valid URL.
  if (error.value) {
    const status = httpStatusFromError(error.value);
    if (status !== null && status >= 400 && status < 500) {
      throwPageNotFound();
    }
    if (import.meta.server) {
      setResponseStatus(503);
    }
    throw createError({
      statusCode: 503,
      statusMessage: 'Page temporarily unavailable',
      cause: error.value,
    });
  }

  if (!data.value?.page) {
    throwPageNotFound();
  }

  const page = computed(() => data.value!.page);

  function isIntroRichTextBlock(block: CmsBlock): block is CmsRichTextBlock {
    if (block.type !== 'rich_text') return false;
    const nodes = (block.content as { content?: Array<{ type?: string }> })?.content ?? [];
    return nodes.length > 0 && nodes.every((node) => node.type === 'paragraph');
  }

  const introBlock = computed(() => {
    const first = page.value.content[0];
    return first && isIntroRichTextBlock(first) ? first : null;
  });

  const bodyBlocks = computed(() =>
    introBlock.value ? page.value.content.slice(1) : page.value.content,
  );

  const introHtml = ref('');

  async function loadIntroHtml() {
    const block = introBlock.value;
    if (!block) {
      introHtml.value = '';
      return;
    }
    introHtml.value = await renderCmsRichTextHtml(block.content as CmsRichTextDocument);
  }

  await loadIntroHtml();
  watch(introBlock, () => {
    void loadIntroHtml();
  });

  const imageIds = computed(() =>
    page.value.content
      .filter((block): block is Extract<typeof block, { type: 'image' }> => block.type === 'image')
      .map((block) => block.imageId),
  );

  const imageUrls = ref<Record<string, string>>({});

  async function loadImageUrls() {
    imageUrls.value = await fetchCmsMediaUrls(apiUrl, imageIds.value);
  }

  await loadImageUrls();

  usePageSeo(
    computed(() => ({
      title: page.value.title,
      description: page.value.description ?? undefined,
    })),
  );

  const { acknowledgeNotice } = usePersonalDataNotice();

  onMounted(() => {
    if (slug.value === 'personal-data') {
      acknowledgeNotice();
    }
  });
</script>

<style scoped>
  .cms-intro :deep(p) {
    @apply mt-4 text-gray-600 dark:text-gray-300 leading-relaxed;
  }
  .cms-intro :deep(p:first-child) {
    @apply mt-4;
  }
</style>
