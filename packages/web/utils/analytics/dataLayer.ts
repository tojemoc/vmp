declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/** Push a structured event to GTM `dataLayer` (marketing / admin-configured tags). */
export function pushDataLayerEvent(event: string, params: Record<string, unknown> = {}): void {
  if (import.meta.server || typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ ...params, event });
}

/** Offline download funnel events — consumed by GTM when enabled. */
export function trackOfflineDataLayerEvent(
  event: string,
  params: Record<string, unknown> = {},
): void {
  pushDataLayerEvent(event, { ...params, offline: true });
}
