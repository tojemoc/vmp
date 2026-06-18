/** localStorage key — records that the visitor has seen the personal-data notice banner. */
export const PERSONAL_DATA_NOTICE_ACK_KEY = 'vmp_personal_data_notice_ack'

// Module-level state — shared across all usePersonalDataNotice() calls (see useAuth.ts).
const hidden = ref(true)

/**
 * Site-wide informational notice (not a marketing consent banner).
 * Shown until the visitor dismisses it or opens the full notice page.
 */
export function usePersonalDataNotice() {
  onMounted(() => {
    try {
      hidden.value = localStorage.getItem(PERSONAL_DATA_NOTICE_ACK_KEY) === '1'
    } catch {
      hidden.value = false
    }
  })

  const showBanner = computed(() => import.meta.client && !hidden.value)

  function acknowledgeNotice() {
    hidden.value = true
    if (!import.meta.client) return
    try {
      localStorage.setItem(PERSONAL_DATA_NOTICE_ACK_KEY, '1')
    } catch {
      // Best effort — banner still hides for this session.
    }
  }

  return {
    showBanner,
    acknowledgeNotice,
  }
}
