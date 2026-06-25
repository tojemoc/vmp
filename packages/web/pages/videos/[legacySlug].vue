<script setup lang="ts">
import { canonicalWatchToken } from '@vmp/shared'

const route = useRoute()
const config = useRuntimeConfig()
const legacySlug = computed(() => String(route.params.legacySlug ?? '').trim())

type VideoMetaResponse = {
  id: string
  slug: string | null
  canonicalWatchPath?: string
}

const { data: resolvedMeta, error: resolveError } = await useAsyncData(
  () => `legacy-video-resolve-${legacySlug.value}`,
  async () => {
    if (!legacySlug.value) return null
    return $fetch<VideoMetaResponse>(
      `${config.public.apiUrl}/api/videos/${encodeURIComponent(legacySlug.value)}/meta`,
    )
  },
  { watch: [legacySlug] },
)

if (resolveError.value || !resolvedMeta.value) {
  if (import.meta.server) {
    setResponseStatus(404)
  }
  throw createError({
    statusCode: 404,
    statusMessage: 'Video not found',
  })
}

const targetPath = resolvedMeta.value.canonicalWatchPath
  ?? `/watch/${encodeURIComponent(canonicalWatchToken(resolvedMeta.value))}`

if (import.meta.server) {
  await navigateTo(targetPath, { redirectCode: 301 })
} else {
  await navigateTo(targetPath, { replace: true })
}
</script>
