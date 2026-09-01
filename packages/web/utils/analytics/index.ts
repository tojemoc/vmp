/**
 * Canonical third-party analytics / observability roles for `@vmp/web`.
 *
 * | Surface            | Tool     | Plugin / module              | Consent / basis        |
 * |--------------------|----------|------------------------------|------------------------|
 * | Product funnels    | PostHog  | `@posthog/nuxt` + plugins    | Explicit banner        |
 * | Error monitoring   | Sentry   | `@sentry/nuxt/module`        | Legitimate interest    |
 * | Marketing tags     | GTM      | `plugins/gtm-settings.client`| Admin opt-in (D1)      |
 *
 * Server-side only (API Worker — see `packages/api/src/logger.ts`):
 * PostHog Logs (OTLP), optional Datadog direct shipping, Sentry.
 *
 * Retired / not loaded in app code: Contentsquare, Umami (standalone), Plausible.
 * Cookieless pageview counts when analytics is declined are handled by PostHog
 * `cookieless_mode: on_reject` — no separate pageview SDK.
 */
export const ANALYTICS_TOOL_ROLES = {
  product: 'posthog',
  errors: 'sentry',
  marketing: 'gtm',
} as const;

export { isBenignAbortError, shouldDropPostHogExceptionEvent } from './noiseFilter';
export { pushDataLayerEvent, trackOfflineDataLayerEvent } from './dataLayer';
export { captureProductEvent } from './product';
