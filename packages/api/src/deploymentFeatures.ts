import {
  type DeploymentFeatureId,
  type DeploymentFeatureState,
  DEPLOYMENT_FEATURE_CATALOG,
  DEPLOYMENT_FEATURE_IDS,
  parseDeploymentFeaturesEnv,
} from '@vmp/shared';

export type { DeploymentFeatureId, DeploymentFeatureState };

let cachedFeatures: Set<DeploymentFeatureId> | null = null;
let cachedEnvKey = '';

function featureEnvKey(env: { VMP_FEATURES?: string }): string {
  return String(env.VMP_FEATURES ?? '').trim();
}

/** Resolved compile-time allowlist for this Worker isolate (memoized per env string). */
export function getCompiledDeploymentFeatures(env: {
  VMP_FEATURES?: string;
}): Set<DeploymentFeatureId> {
  const key = featureEnvKey(env);
  if (cachedFeatures && cachedEnvKey === key) return cachedFeatures;
  cachedEnvKey = key;
  cachedFeatures = parseDeploymentFeaturesEnv({ VMP_FEATURES: key || undefined });
  return cachedFeatures;
}

export function isDeploymentFeatureCompiled(
  env: { VMP_FEATURES?: string },
  id: DeploymentFeatureId,
): boolean {
  return getCompiledDeploymentFeatures(env).has(id);
}

export function buildDeploymentFeatureManifest(env: {
  VMP_FEATURES?: string;
}): Record<DeploymentFeatureId, DeploymentFeatureState> {
  const requested = getCompiledDeploymentFeatures(env);
  const manifest = {} as Record<DeploymentFeatureId, DeploymentFeatureState>;
  for (const id of DEPLOYMENT_FEATURE_IDS) {
    const isRequested = requested.has(id);
    manifest[id] = {
      requested: isRequested,
      pluginPresent: true,
      compiled: isRequested,
    };
  }
  return manifest;
}

export function deploymentFeatureCatalogForAdmin() {
  return DEPLOYMENT_FEATURE_CATALOG;
}
