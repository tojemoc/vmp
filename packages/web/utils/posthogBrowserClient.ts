import type { PostHogPersistenceClient } from '~/utils/posthogConsent';

export type PostHogIdentityClient = PostHogPersistenceClient & {
  reset?: () => void;
  identify?: (distinctId: string, properties?: Record<string, unknown>) => void;
};

/** Browser PostHog singleton set by `@posthog/nuxt` / posthog-js after init. */
export function getBrowserPostHog(): PostHogIdentityClient | undefined {
  if (!import.meta.client) return undefined;
  const client = (window as Window & { posthog?: PostHogIdentityClient }).posthog;
  if (!client) return undefined;
  return client;
}
