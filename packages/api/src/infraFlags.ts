/**
 * Tier-1 infrastructure feature flags.
 *
 * Phase A: prefer Cloudflare Flagship (`env.FLAGS`) with code default `false`.
 * Temporary fallback: `VMP_FEATURES` env allowlist (removed in Phase B).
 * Local override: `FLAGSHIP_DEV_OVERRIDE` (same CSV syntax as VMP_FEATURES; .dev.vars only).
 *
 * @see docs/plans/flagship-and-payment-middleware.md
 */
import {
  type DeploymentFeatureId,
  type DeploymentFeatureState,
  DEPLOYMENT_FEATURE_IDS,
  parseDeploymentFeaturesEnv,
} from '@vmp/shared';
import { getCompiledDeploymentFeatures } from './deploymentFeatures.js';

/** Minimal Flagship binding surface used by this Worker. */
export type FlagshipBinding = {
  getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context?: Record<string, unknown>,
  ): Promise<boolean>;
};

export type InfraFlagsEnv = {
  FLAGS?: FlagshipBinding;
  VMP_FEATURES?: string;
  /** Local/dev CSV allowlist — never set in staging/prod deploy. */
  FLAGSHIP_DEV_OVERRIDE?: string;
};

function parseOverrideAllowlist(raw: string | undefined): Set<DeploymentFeatureId> | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  return parseDeploymentFeaturesEnv({ VMP_FEATURES: trimmed });
}

/**
 * Resolve whether an infrastructure feature is enabled for this deployment.
 * Safe default is OFF when Flagship is bound (missing/failed eval → false).
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

  // Temporary Phase A fallback until VMP_FEATURES is removed (Phase B).
  return getCompiledDeploymentFeatures(env).has(id);
}

/** Build admin/UI manifest from the active evaluator (Flagship or fallback). */
export async function buildInfraFeatureManifest(
  env: InfraFlagsEnv,
): Promise<Record<DeploymentFeatureId, DeploymentFeatureState>> {
  const manifest = {} as Record<DeploymentFeatureId, DeploymentFeatureState>;
  for (const id of DEPLOYMENT_FEATURE_IDS) {
    const enabled = await isInfraFeatureEnabled(env, id);
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
