/**
 * PostHog pageview mode for Nuxt (SPA).
 *
 * - `true` — only the initial document load (misses vue-router navigations)
 * - `history_change` — initial load + History API pathname changes (pushState /
 *   replaceState / popstate), which is what PostHog recommends for SPAs
 *
 * Kept as a shared constant so config and tests stay aligned.
 */
export const POSTHOG_CAPTURE_PAGEVIEW = 'history_change' as const;

export const POSTHOG_CAPTURE_PAGELEAVE = 'if_capture_pageview' as const;
