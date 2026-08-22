/** Accepted public env var names for the PostHog project token (build + runtime). */
const POSTHOG_PUBLIC_KEY_ENV_NAMES = [
  'NUXT_PUBLIC_POSTHOG_KEY',
  'NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN',
  /** Nuxt nested override for `runtimeConfig.public.posthog.publicKey`. */
  'NUXT_PUBLIC_POSTHOG_PUBLIC_KEY',
] as const;

/** Resolve the PostHog public project token from process env (build time). */
export function resolvePostHogPublicKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const name of POSTHOG_PUBLIC_KEY_ENV_NAMES) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

type RuntimePostHogConfig = {
  publicKey?: string;
};

type RuntimeConfigLike = {
  public?: {
    posthog?: RuntimePostHogConfig;
  };
};

/** Read the baked PostHog token from Nuxt runtime config (client or SSR). */
export function resolvePostHogPublicKeyFromRuntimeConfig(
  config: RuntimeConfigLike,
): string {
  const fromRuntime = config.public?.posthog?.publicKey;
  return typeof fromRuntime === 'string' ? fromRuntime.trim() : '';
}

export function isPostHogConfigured(config: RuntimeConfigLike): boolean {
  return resolvePostHogPublicKeyFromRuntimeConfig(config).length > 0;
}
