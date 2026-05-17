/**
 * Injects the Contentsquare tracking script into <head> on every page when configured.
 * Script URL is read from the public site-settings API (admin enables + sets full src URL).
 */

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const { data } = useLazyFetch<{ contentsquare_script_src?: string | null }>(
    `${config.public.apiUrl}/api/site-settings`,
    { key: 'site-settings-contentsquare' },
  )

  const src = computed(() => {
    const url = data.value?.contentsquare_script_src
    return typeof url === 'string' && url.startsWith('https://') ? url : null
  })

  useHead({
    script: computed(() =>
      src.value ? [{ src: src.value, tagPosition: 'head' as const }] : [],
    ),
  })
})
