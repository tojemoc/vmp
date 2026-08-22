import type { PostHogPersistenceClient } from '~/utils/posthogConsent';

export type PostHogIdentityClient = PostHogPersistenceClient & {
  __loaded?: boolean;
  reset?: () => void;
  identify?: (distinctId: string, properties?: Record<string, unknown>) => void;
  capture?: (event: string, properties?: Record<string, unknown>) => unknown;
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
