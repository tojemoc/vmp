<template>
  <div class="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-950">
    <AppHeader />

    <main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">
          {{ strings.personalDataPageTitle }}
        </h1>
        <p
          v-for="(paragraph, index) in personalDataPage.intro"
          :key="`intro-${index}`"
          class="mt-4 text-gray-600 dark:text-gray-300 leading-relaxed"
        >
          {{ paragraph }}
        </p>
      </header>

      <article class="space-y-10">
        <section
          v-for="section in personalDataPage.sections"
          :id="section.id"
          :key="section.id"
          class="scroll-mt-24"
        >
          <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ section.title }}
          </h2>
          <p
            v-for="(paragraph, index) in section.paragraphs"
            :key="`${section.id}-p-${index}`"
            class="mt-3 text-gray-600 dark:text-gray-300 leading-relaxed"
          >
            {{ paragraph }}
          </p>

          <ul
            v-if="section.bullets?.length"
            class="mt-3 list-disc pl-5 space-y-1 text-gray-600 dark:text-gray-300"
          >
            <li v-for="(bullet, index) in section.bullets" :key="`${section.id}-b-${index}`">
              {{ bullet }}
            </li>
          </ul>

          <div
            v-if="section.id === 'storage-table'"
            class="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <table class="min-w-full text-sm text-left">
              <thead class="bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
                <tr>
                  <th scope="col" class="px-3 py-2 font-semibold">{{ strings.personalDataTableName }}</th>
                  <th scope="col" class="px-3 py-2 font-semibold">{{ strings.personalDataTableMechanism }}</th>
                  <th scope="col" class="px-3 py-2 font-semibold">{{ strings.personalDataTablePurpose }}</th>
                  <th scope="col" class="px-3 py-2 font-semibold">{{ strings.personalDataTableLifetime }}</th>
                  <th scope="col" class="px-3 py-2 font-semibold">{{ strings.personalDataTableNecessary }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
                <tr
                  v-for="row in personalDataPage.storageRows"
                  :key="row.name"
                  class="text-gray-600 dark:text-gray-300"
                >
                  <td class="px-3 py-2 font-mono text-xs">{{ row.name }}</td>
                  <td class="px-3 py-2">{{ row.mechanism }}</td>
                  <td class="px-3 py-2">{{ row.purpose }}</td>
                  <td class="px-3 py-2">{{ row.lifetime }}</td>
                  <td class="px-3 py-2">{{ row.necessary }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
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
import { getPersonalDataPage } from '~/utils/personalDataProcessing'

const { strings, personalData } = useStrings()
const personalDataPage = computed(() => personalData.value ?? getPersonalDataPage())

usePageSeo(
  computed(() => ({
    title: personalDataPage.value.metaTitle,
    description: personalDataPage.value.metaDescription,
  })),
)

const { acknowledgeNotice } = usePersonalDataNotice()

onMounted(() => {
  acknowledgeNotice()
})
</script>
