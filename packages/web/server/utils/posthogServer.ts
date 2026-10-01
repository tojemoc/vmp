/**
 * Shared PostHog Node client for Nuxt SSR — capture + feature-flag evaluation.
 * Does not create product flags; helpers are ready for future Tier-2 experiments.
 *
 * @see docs/plans/flagship-and-payment-middleware.md Phase C
 */
import { PostHog } from 'posthog-node';
import { isPostHogConfigured } from '../../utils/posthogPublicKey';

type RuntimeConfigLike = {
  public?: {
    posthog?: { publicKey?: string; host?: string };
    deployTier?: string;
  };
};

let client: PostHog | undefined;

function resolveClient(config: RuntimeConfigLike): PostHog | null {
  if (!isPostHogConfigured(config)) return null;
  const publicKey = (config.public?.posthog?.publicKey ?? '').trim();
  if (!publicKey) return null;
  const host = (config.public?.posthog?.host ?? '').trim() || undefined;
  client ??= new PostHog(publicKey, { host, flushAt: 1, flushInterval: 0 });
  return client;
}

/** Evaluate a PostHog feature flag on the server (no browser round-trip). */
export async function getServerPostHogFeatureFlag(
  flagKey: string,
  distinctId: string,
  options?: { personProperties?: Record<string, string>; groups?: Record<string, string> },
): Promise<boolean | string | undefined> {
  const config = useRuntimeConfig() as RuntimeConfigLike;
  const ph = resolveClient(config);
  if (!ph || !distinctId.trim()) return undefined;
  return ph.getFeatureFlag(flagKey, distinctId.trim(), {
    personProperties: options?.personProperties,
    groups: options?.groups,
  });
}

/** Fetch all PostHog feature flags for a distinct id (server-side). */
export async function getAllServerPostHogFeatureFlags(
  distinctId: string,
  options?: { personProperties?: Record<string, string>; groups?: Record<string, string> },
): Promise<Record<string, boolean | string> | undefined> {
  const config = useRuntimeConfig() as RuntimeConfigLike;
  const ph = resolveClient(config);
  if (!ph || !distinctId.trim()) return undefined;
  return ph.getAllFlags(distinctId.trim(), {
    personProperties: options?.personProperties,
    groups: options?.groups,
  });
}

export async function shutdownServerPostHog(): Promise<void> {
  if (!client) return;
  await client.shutdown();
  client = undefined;
}
