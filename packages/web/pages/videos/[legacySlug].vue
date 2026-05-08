<script setup lang="ts">
const route = useRoute()
const legacySlug = computed(() => String(route.params.legacySlug ?? '').trim())

if (import.meta.server) {
  await navigateTo(`/watch/${encodeURIComponent(legacySlug.value)}`, { redirectCode: 301 })
} else {
  await navigateTo(`/watch/${encodeURIComponent(legacySlug.value)}`, { replace: true })
}
</script>
