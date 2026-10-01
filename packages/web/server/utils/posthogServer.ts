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

type WaitUntilFn = (promise: Promise<unknown>) => void;

/** Duck-type waitUntil from H3 / Cloudflare without unsafe H3Event casts. */
function resolveWaitUntil(event: unknown): WaitUntilFn | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const root = event as Record<string, unknown>;
  if (typeof root.waitUntil === 'function') {
    return (root.waitUntil as WaitUntilFn).bind(event);
  }
  const context = root.context;
  if (!context || typeof context !== 'object') return undefined;
  const ctx = context as Record<string, unknown>;
  if (typeof ctx.waitUntil === 'function') {
    return (ctx.waitUntil as WaitUntilFn).bind(context);
  }
  const cloudflare = ctx.cloudflare;
  if (!cloudflare || typeof cloudflare !== 'object') return undefined;
  const cfContext = (cloudflare as Record<string, unknown>).context;
  if (!cfContext || typeof cfContext !== 'object') return undefined;
  const waitUntil = (cfContext as Record<string, unknown>).waitUntil;
  if (typeof waitUntil !== 'function') return undefined;
  return (waitUntil as WaitUntilFn).bind(cfContext);
}

/** Flush pending PostHog work via waitUntil when available, else await. */
async function settlePendingFlush(ph: PostHog): Promise<void> {
  const flush = Promise.resolve(ph.flush()).catch(() => {});
  try {
    const waitUntil = resolveWaitUntil(useRequestEvent());
    if (waitUntil) {
      waitUntil(flush);
      return;
    }
  } catch {
    // Outside a request context (tests / startup).
  }
  await flush;
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
  const value = await ph.getFeatureFlag(flagKey, distinctId.trim(), {
    personProperties: options?.personProperties,
    groups: options?.groups,
  });
  await settlePendingFlush(ph);
  return value;
}

/** Fetch all PostHog feature flags for a distinct id (server-side). */
export async function getAllServerPostHogFeatureFlags(
  distinctId: string,
  options?: { personProperties?: Record<string, string>; groups?: Record<string, string> },
): Promise<Record<string, boolean | string> | undefined> {
  const config = useRuntimeConfig() as RuntimeConfigLike;
  const ph = resolveClient(config);
  if (!ph || !distinctId.trim()) return undefined;
  const value = await ph.getAllFlags(distinctId.trim(), {
    personProperties: options?.personProperties,
    groups: options?.groups,
  });
  await settlePendingFlush(ph);
  return value;
}

export async function shutdownServerPostHog(): Promise<void> {
  if (!client) return;
  await client.shutdown();
  client = undefined;
}
