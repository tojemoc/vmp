<template>
  <div
    class="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white"
  >
    <main class="max-w-md text-center">
      <p class="text-6xl font-bold tabular-nums text-gray-900 dark:text-white">
        {{ copy.statusCode }}
      </p>
      <h1 class="mt-4 text-2xl font-semibold text-gray-900 dark:text-white">
        {{ copy.title }}
      </h1>
      <p class="mt-2 text-gray-600 dark:text-gray-400">
        {{ copy.description }}
      </p>
      <p class="mt-8">
        <a
          href="/"
          class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
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
  import { errorPageCopy } from '~/utils/errorPageCopy';

  // Replaces Nuxt's built-in error page, which unrouted URLs such as /rss reach through
  // pages/[slug].vue. The built-in 404 ships an inline script that toggles `hidden` on
  // its links before the app hydrates, so the DOM Vue hydrates no longer matches the
  // server HTML. Everything here is derived from the status code and the locale catalog,
  // so the server render and the first client render are identical.
  const props = defineProps<{ error: NuxtError }>();

  const { strings, htmlLang } = useStrings();
  const copy = computed(() => errorPageCopy(props.error?.statusCode, strings.value));

  useHead({
    title: computed(() => `${copy.value.statusCode} – ${copy.value.title}`),
    htmlAttrs: { lang: htmlLang },
  });

  function goHome() {
    void clearError({ redirect: '/' });
  }
</script>
