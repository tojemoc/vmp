import type { PostHogPersistenceClient } from '~/utils/posthogConsent';

export type PostHogIdentityClient = PostHogPersistenceClient & {
  __loaded?: boolean;
  reset?: () => void;
  identify?: (distinctId: string, properties?: Record<string, unknown>) => void;
  setIdentity?: (distinctId: string, hash: string) => void;
  clearIdentity?: () => void;
  capture?: (event: string, properties?: Record<string, unknown>) => unknown;
  captureException?: (error: unknown, properties?: Record<string, unknown>) => unknown;
};

/**
 * PostHog browser client from `@posthog/nuxt` (`$posthog`), with `window.posthog`
 * as fallback. The Nuxt module wraps posthog-js — console tags still say [PostHog.js].
 */
export function getBrowserPostHog(): PostHogIdentityClient | undefined {
  if (!import.meta.client) return undefined;

  try {
    const { $posthog } = useNuxtApp();
    const fromNuxt = typeof $posthog === 'function' ? $posthog() : undefined;
    if (fromNuxt) return fromNuxt as PostHogIdentityClient;
  } catch {
    // Outside Nuxt context (tests) — fall through to window.
  }

  const fromWindow = (window as Window & { posthog?: PostHogIdentityClient }).posthog;
  return fromWindow;
}

/** True when posthog-js has finished init (safe to call identify / opt-in). */
export function isBrowserPostHogReady(client: PostHogIdentityClient | undefined): boolean {
  return Boolean(client && client.__loaded);
}

/**
 * Report a handled error to error tracking.
 *
 * `@posthog/nuxt` only captures what reaches Vue's error handler, so an error a component
 * catches itself is invisible — and during a client-side route change that is every
 * failure. Call this whenever a caught error means the user lost a feature.
 */
export function captureBrowserException(
  error: unknown,
  properties: Record<string, unknown> = {},
): void {
  if (!import.meta.client) return;
  try {
    const client = getBrowserPostHog();
    if (!isBrowserPostHogReady(client)) return;
    client?.captureException?.(error, properties);
  } catch {
    // Never let telemetry break the surface it is reporting on.
  }
}
