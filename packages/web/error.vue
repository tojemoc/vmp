<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <main class="max-w-md text-center">
      <p class="text-6xl font-bold text-gray-900 dark:text-white">{{ statusCode }}</p>
      <h1 class="mt-4 text-xl font-semibold text-gray-900 dark:text-white">{{ title }}</h1>
      <p class="mt-8 text-sm">
        <a
          href="/"
          class="text-blue-600 dark:text-blue-400 hover:underline"
          @click.prevent="goHome"
        >
          {{ strings.backToHomepage }}
        </a>
      </p>
    </main>
  </div>
</template>

<script setup lang="ts">
  import type { NuxtError } from '#app';
  import { errorPageTitleKey } from '~/utils/unroutedPaths';

  // Replaces Nuxt's default error page, which hydrated with mismatches on 404s from
  // the CMS catch-all. Markup depends only on the serialized status code and the
  // deployment locale, never on auth, clocks, or the error message.
  const props = defineProps<{ error: NuxtError }>();
  const { strings, htmlLang } = useStrings();

  const statusCode = computed(() => props.error?.statusCode ?? 500);
  const title = computed(() => strings.value[errorPageTitleKey(statusCode.value)]);

  useHead({ title, htmlAttrs: { lang: htmlLang } });

  function goHome() {
    void clearError({ redirect: '/' });
  }
</script>
