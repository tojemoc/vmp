<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open && category && draft"
        class="fixed inset-0 z-50 flex justify-end"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-black/40" aria-hidden="true" />
        <Transition
          enter-active-class="transition-transform duration-200"
          enter-from-class="translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-200"
          leave-from-class="translate-x-0"
          leave-to-class="translate-x-full"
        >
          <aside
            v-if="open && category && draft"
            class="relative w-full max-w-md h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl overflow-y-auto"
            role="dialog"
            aria-modal="true"
            :aria-label="`Edit category ${category.name}`"
          >
            <div class="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Edit category</h3>
              <button type="button" class="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" @click="emit('close')">✕</button>
            </div>

            <form class="p-5 space-y-4" @submit.prevent="emit('save', draft)">
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Name
                <input v-model="draft.name" type="text" required class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              </label>
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Slug
                <input v-model="draft.slug" type="text" required class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm" />
              </label>
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Sort order
                <input v-model.number="draft.sort_order" type="number" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              </label>
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Direction
                <select v-model="draft.direction" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="desc">desc</option>
                  <option value="asc">asc</option>
                </select>
              </label>
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Homepage layout variant
                <select v-model="draft.homepage_layout_variant" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  <option value="three_by_one">3×1 block</option>
                  <option value="side_mini">2×1 small block</option>
                </select>
              </label>
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Rec. recency bias
                <input v-model.number="draft.recommendation_recency_bias" type="number" min="0" step="0.1" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              </label>
              <label class="block text-sm text-gray-700 dark:text-gray-300">
                Rec. low-views boost
                <input v-model.number="draft.recommendation_low_views_boost" type="number" min="0" step="0.1" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
              </label>
              <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input v-model="draft.recommendation_category_lock" type="checkbox" :true-value="1" :false-value="0" class="rounded border-gray-300 dark:border-gray-600">
                Stay in category only
              </label>

              <div class="flex flex-wrap gap-2 pt-2">
                <button type="submit" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">Save</button>
                <button type="button" :class="secondaryButtonClass" @click="emit('close')">Cancel</button>
              </div>

              <div class="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <template v-if="!confirmDelete">
                  <button type="button" class="text-sm text-red-600 dark:text-red-400 hover:underline" @click="confirmDelete = true">Delete category…</button>
                </template>
                <template v-else>
                  <p class="text-sm text-gray-700 dark:text-gray-300">
                    Delete <strong>{{ category.name }}</strong>? This cannot be undone.
                  </p>
                  <label v-if="(category.video_count ?? 0) > 0" class="block text-sm text-gray-700 dark:text-gray-300">
                    Reassign videos to
                    <select v-model="reassignToId" class="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                      <option value="">— select category —</option>
                      <option v-for="c in otherCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                  </label>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
                      :disabled="(category.video_count ?? 0) > 0 && !reassignToId"
                      @click="emit('delete', { reassignToId: reassignToId || undefined })"
                    >
                      Confirm delete
                    </button>
                    <button type="button" :class="secondaryButtonSmClass" @click="confirmDelete = false">Cancel</button>
                  </div>
                </template>
              </div>
            </form>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
export interface AdminCategoryRow {
  id: string
  name: string
  slug: string
  sort_order: number
  direction: 'asc' | 'desc'
  homepage_layout_variant?: 'three_by_one' | 'side_mini'
  recommendation_recency_bias?: number
  recommendation_low_views_boost?: number
  recommendation_category_lock?: number
  video_count?: number
}

const props = defineProps<{
  open: boolean
  category: AdminCategoryRow | null
  allCategories: AdminCategoryRow[]
}>()

const emit = defineEmits<{
  close: []
  save: [category: AdminCategoryRow]
  delete: [opts: { reassignToId?: string }]
}>()

const secondaryButtonClass = 'px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
const secondaryButtonSmClass = 'px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
const draft = ref<AdminCategoryRow | null>(null)
const confirmDelete = ref(false)
const reassignToId = ref('')

const otherCategories = computed(() =>
  props.allCategories.filter((c) => c.id !== props.category?.id),
)

watch(() => props.category, (cat) => {
  if (!cat) {
    draft.value = null
    return
  }
  draft.value = {
    ...cat,
    homepage_layout_variant: cat.homepage_layout_variant === 'side_mini' ? 'side_mini' : 'three_by_one',
    recommendation_recency_bias: Number(cat.recommendation_recency_bias ?? 1),
    recommendation_low_views_boost: Number(cat.recommendation_low_views_boost ?? 0),
    recommendation_category_lock: Number(cat.recommendation_category_lock ?? 0),
  }
  confirmDelete.value = false
  reassignToId.value = ''
}, { immediate: true })
</script>
