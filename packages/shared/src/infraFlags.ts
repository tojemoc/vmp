/**
 * Shared Tier-1 Flagship evaluation helpers for Workers (API + billing).
 *
 * Code default is OFF (`getBooleanValue(id, false)`).
 * Local override: `FLAGSHIP_DEV_OVERRIDE` CSV (`.dev.vars` only — never staging/prod).
 *
 * @see docs/plans/flagship-and-payment-middleware.md
 */
import {
  type DeploymentFeatureId,
  type DeploymentFeatureState,
  DEPLOYMENT_FEATURE_IDS,
  parseFeatureAllowlistCsv,
} from './deploymentFeatures.js';

/** Minimal Flagship binding surface used by Workers. */
export type FlagshipBinding = {
  getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context?: Record<string, unknown>,
  ): Promise<boolean>;
};

export type InfraFlagsEnv = {
  FLAGS?: FlagshipBinding;
  /** Local/dev CSV allowlist — never set in staging/prod deploy. */
  FLAGSHIP_DEV_OVERRIDE?: string;
};

function parseOverrideAllowlist(raw: string | undefined): Set<DeploymentFeatureId> | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  return parseFeatureAllowlistCsv(trimmed);
}

/**
 * Resolve whether an infrastructure feature is enabled for this deployment.
 * Unbound / failed Flagship evaluation → false.
 */
export async function isInfraFeatureEnabled(
  env: InfraFlagsEnv,
  id: DeploymentFeatureId,
): Promise<boolean> {
  const override = parseOverrideAllowlist(env.FLAGSHIP_DEV_OVERRIDE);
  if (override) return override.has(id);

  if (env.FLAGS) {
    try {
      return await env.FLAGS.getBooleanValue(id, false);
    } catch {
      return false;
    }
  }

  return false;
}

/** Build admin/UI manifest from Flagship (or local override). */
export async function buildInfraFeatureManifest(
  env: InfraFlagsEnv,
): Promise<Record<DeploymentFeatureId, DeploymentFeatureState>> {
  const ids = [...DEPLOYMENT_FEATURE_IDS];
  const enabledFlags = await Promise.all(ids.map((id) => isInfraFeatureEnabled(env, id)));
  const manifest = {} as Record<DeploymentFeatureId, DeploymentFeatureState>;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const enabled = enabledFlags[i]!;
    manifest[id] = {
      requested: enabled,
      pluginPresent: true,
      compiled: enabled,
    };
  }
  return manifest;
}

/** Test helper: Flagship-like binding that returns true only for listed ids. */
export function createStaticFlagshipBinding(
  enabledIds: readonly DeploymentFeatureId[],
): FlagshipBinding {
  const set = new Set<string>(enabledIds);
  return {
    async getBooleanValue(flagKey, defaultValue) {
      if (set.has(flagKey)) return true;
      return defaultValue;
    },
  };
}
