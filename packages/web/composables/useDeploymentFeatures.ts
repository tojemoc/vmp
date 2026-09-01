import type {
  DeploymentFeatureId,
  DeploymentFeatureState,
} from '@vmp/shared';
import type { WebDeploymentFeatures } from '~/utils/resolveDeploymentFeatures';

type DeploymentFeaturesPublicConfig = WebDeploymentFeatures | Record<string, DeploymentFeatureState>;

function emptyFeatureState(): DeploymentFeatureState {
  return { requested: false, pluginPresent: false, compiled: false };
}

/**
 * Read compile-time deployment feature flags baked into `runtimeConfig.public.deploymentFeatures`.
 */
export function useDeploymentFeatures() {
  const config = useRuntimeConfig();

  const features = computed<DeploymentFeaturesPublicConfig>(() => {
    const raw = config.public.deploymentFeatures as DeploymentFeaturesPublicConfig | undefined;
    return raw ?? {};
  });

  function featureState(id: DeploymentFeatureId): DeploymentFeatureState {
    return features.value[id] ?? emptyFeatureState();
  }

  function isCompiled(id: DeploymentFeatureId): boolean {
    return featureState(id).compiled;
  }

  function isRequested(id: DeploymentFeatureId): boolean {
    return featureState(id).requested;
  }

  function unavailableReason(id: DeploymentFeatureId): string | null {
    const state = featureState(id);
    if (state.compiled) return null;
    if (!state.requested) {
      return 'This feature is not included in the VMP_FEATURES allowlist for this deployment.';
    }
    if (!state.pluginPresent) {
      return 'Plugin files for this feature are missing from this build.';
    }
    return 'This feature is not available in this deployment.';
  }

  return {
    features,
    featureState,
    isCompiled,
    isRequested,
    unavailableReason,
  };
}
