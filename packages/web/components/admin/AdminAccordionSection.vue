<template>
  <details
    class="rounded-lg border border-gray-200 dark:border-gray-700 group"
    :open="open"
    @toggle="onToggle"
  >
    <summary class="cursor-pointer list-none px-4 py-3 font-semibold text-gray-900 dark:text-white flex items-center justify-between gap-2 select-none">
      <span>{{ title }}</span>
      <span class="text-gray-400 dark:text-gray-500 text-sm group-open:rotate-180 transition-transform" aria-hidden="true">▾</span>
    </summary>
    <div class="px-4 pb-4 pt-1 space-y-4 border-t border-gray-100 dark:border-gray-800">
      <slot />
    </div>
  </details>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  sectionKey: string
  title: string
  defaultOpen?: boolean
}>(), {
  defaultOpen: true,
})

const storageKey = computed(() => `vmp-admin-accordion:${props.sectionKey}`)

const open = ref(props.defaultOpen)

onMounted(() => {
  if (!import.meta.client) return
  const stored = localStorage.getItem(storageKey.value)
  if (stored === '0') open.value = false
  else if (stored === '1') open.value = true
})

function onToggle(event: Event) {
  const el = event.target as HTMLDetailsElement
  open.value = el.open
  if (import.meta.client) {
    localStorage.setItem(storageKey.value, el.open ? '1' : '0')
  }
}
</script>
