<template>
  <footer class="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 mt-auto">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
      <span class="font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
        {{ tierName }}
      </span>
      <span>
        Build
        <a
          v-if="commitUrl"
          :href="commitUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-1 font-mono text-gray-700 dark:text-gray-200 hover:underline"
          :title="gitCommit || undefined"
        >{{ label }}</a>
        <span
          v-else
          class="ml-1 font-mono text-gray-700 dark:text-gray-200"
          :title="gitCommit || undefined"
        >{{ label }}</span>
      </span>
    </div>
  </footer>
</template>

<script setup lang="ts">
const { tierName, label, gitCommit, commitUrl } = useBuildInfo()
</script>
