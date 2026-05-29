/**
 * Track push-attributed watch sessions on /watch pages.
 */
export function usePushAttribution(options: {
  videoId: () => string
  currentTime: () => number
  duration: () => number
}) {
  const config = useRuntimeConfig()
  const route = useRoute()
  const sessionStarted = ref(false)
  const sessionStartMs = ref<number | null>(null)
  const maxRetentionPercent = ref(0)
  const videosWatched = ref<string[]>([])

  const deliveryId = computed(() => {
    const fromQuery = route.query.nid
    if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim()
    if (import.meta.client) {
      return sessionStorage.getItem('vmp_push_nid') || ''
    }
    return ''
  })

  function persistDeliveryId(id: string) {
    if (!import.meta.client || !id) return
    sessionStorage.setItem('vmp_push_nid', id)
  }

  async function postPushEvent(body: Record<string, unknown>) {
    if (!import.meta.client) return
    try {
      await fetch(`${config.public.apiUrl}/api/push/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      })
    } catch {
      // Best-effort analytics
    }
  }

  function trackRetentionFromPlayer() {
    const duration = options.duration()
    const time = options.currentTime()
    if (!duration || duration <= 0 || !Number.isFinite(time)) return
    const pct = Math.min(100, Math.max(0, (time / duration) * 100))
    if (pct > maxRetentionPercent.value) maxRetentionPercent.value = pct
  }

  function recordVideoInSession(videoId: string) {
    if (!videoId || videosWatched.value.includes(videoId)) return
    videosWatched.value = [...videosWatched.value, videoId]
  }

  async function endSession() {
    const nid = deliveryId.value
    if (!nid || !sessionStarted.value) return
    trackRetentionFromPlayer()
    const originVideoId = videosWatched.value[0] || options.videoId()
    const others = videosWatched.value.filter((id) => id !== originVideoId)
    const sessionDurationSeconds = sessionStartMs.value
      ? Math.max(0, Math.floor((Date.now() - sessionStartMs.value) / 1000))
      : 0
    await postPushEvent({
      type: 'session_end',
      deliveryId: nid,
      originVideoId,
      originMaxRetentionPercent: Number(maxRetentionPercent.value.toFixed(2)),
      videosWatchedCount: videosWatched.value.length || 1,
      otherVideosWatched: others,
      sessionDurationSeconds,
    })
    sessionStarted.value = false
  }

  async function startSessionForVideo(videoId: string) {
    const nid = deliveryId.value
    if (!nid || !import.meta.client) return
    persistDeliveryId(nid)
    recordVideoInSession(videoId)
    if (sessionStarted.value) return
    sessionStarted.value = true
    sessionStartMs.value = Date.now()
    maxRetentionPercent.value = 0
    await postPushEvent({
      type: 'session_start',
      deliveryId: nid,
      originVideoId: videoId,
    })
    try {
      const gtm = useGtm()
      gtm?.trackEvent?.({
        event: 'push_attributed_view',
        deliveryId: nid,
        videoId,
      })
    } catch {
      // GTM optional
    }
  }

  watch(
    () => options.videoId(),
    (videoId) => {
      if (!videoId) return
      void startSessionForVideo(videoId)
    },
    { immediate: true },
  )

  watch(
    () => [options.currentTime(), options.duration()] as const,
    () => trackRetentionFromPlayer(),
  )

  if (import.meta.client) {
    onMounted(() => {
      const fromQuery = route.query.nid
      if (typeof fromQuery === 'string' && fromQuery.trim()) {
        persistDeliveryId(fromQuery.trim())
      }
      window.addEventListener('pagehide', () => { void endSession() })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void endSession()
      })
    })
    onUnmounted(() => {
      void endSession()
    })
  }

  return {
    deliveryId,
    trackRetentionFromPlayer,
    endSession,
  }
}
