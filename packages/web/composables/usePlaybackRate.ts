import { ref } from 'vue'

export const PLAYBACK_RATE_STORAGE_KEY = 'playbackRate'

export const PLAYBACK_RATE_OPTIONS = [
  { value: 0.5, label: '0.5×' },
  { value: 0.75, label: '0.75×' },
  { value: 1, label: '1×' },
  { value: 1.25, label: '1.25×' },
  { value: 1.5, label: '1.5×' },
  { value: 2, label: '2×' },
] as const

const ALLOWED_VALUES = new Set(PLAYBACK_RATE_OPTIONS.map((o) => o.value))

function readStoredPlaybackRate(): number {
  if (import.meta.server) return 1
  try {
    const raw = localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY)
    if (raw == null) return 1
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return 1
    return ALLOWED_VALUES.has(parsed as (typeof PLAYBACK_RATE_OPTIONS)[number]['value'])
      ? parsed
      : 1
  } catch {
    return 1
  }
}

type MediaWithPlaybackRate = {
  playbackRate: number
}

/**
 * Persisted playback speed for HTMLMediaElement-based VOD players (HLS via native video).
 */
export function usePlaybackRate() {
  const playbackRate = ref(readStoredPlaybackRate())

  const applyPlaybackRate = (media: MediaWithPlaybackRate | null | undefined) => {
    if (!media) return
    media.playbackRate = playbackRate.value
  }

  const setPlaybackRate = (rate: number) => {
    if (!ALLOWED_VALUES.has(rate as (typeof PLAYBACK_RATE_OPTIONS)[number]['value'])) return
    playbackRate.value = rate
    if (!import.meta.server) {
      try {
        localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate))
      } catch { /* quota / private mode */ }
    }
  }

  return {
    playbackRate,
    applyPlaybackRate,
    setPlaybackRate,
  }
}
