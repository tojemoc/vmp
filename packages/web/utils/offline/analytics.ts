declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
  }
}

export function trackOfflineEvent(
  event: string,
  params: Record<string, unknown> = {},
): void {
  if (import.meta.server || typeof window === 'undefined') return
  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({
    ...params,
    event,
    offline: true,
  })
}
