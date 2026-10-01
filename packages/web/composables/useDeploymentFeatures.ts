import {
  type DeploymentFeatureId,
  type DeploymentFeatureState,
  DEPLOYMENT_FEATURE_IDS,
} from '@vmp/shared';

function emptyFeatureState(): DeploymentFeatureState {
  return { requested: false, pluginPresent: false, compiled: false };
}

type FeaturesMap = Partial<Record<DeploymentFeatureId, DeploymentFeatureState>>;

type NuxtAppWithHydrate = ReturnType<typeof useNuxtApp> & {
  _deploymentFeaturesHydrate?: Promise<void> | null;
};

/**
 * Hydrate infrastructure flags from GET /api/deployment-features (Flagship via API).
 */
export function useDeploymentFeatures() {
  const config = useRuntimeConfig();
  const apiUrl = String(config.public.apiUrl || '').replace(/\/$/, '');
  const nuxtApp = useNuxtApp() as NuxtAppWithHydrate;
  const features = useState<FeaturesMap>('deployment-features-manifest', () => ({}));
  const loaded = useState<boolean>('deployment-features-loaded', () => false);
  const fetchError = useState<string | null>('deployment-features-error', () => null);

  async function hydrate() {
    if (loaded.value) return;
    if (nuxtApp._deploymentFeaturesHydrate) return nuxtApp._deploymentFeaturesHydrate;
    nuxtApp._deploymentFeaturesHydrate = (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/deployment-features`);
        if (!res.ok) {
          fetchError.value = `HTTP ${res.status}`;
          return;
        }
        const data = (await res.json()) as { features?: FeaturesMap };
        if (data.features && typeof data.features === 'object') {
          features.value = data.features;
          loaded.value = true;
          fetchError.value = null;
        } else {
          fetchError.value = 'invalid_response';
        }
      } catch (err) {
        fetchError.value = err instanceof Error ? err.message : 'fetch_failed';
      } finally {
        nuxtApp._deploymentFeaturesHydrate = null;
      }
    })();
    return nuxtApp._deploymentFeaturesHydrate;
  }

  if (import.meta.server) {
    onServerPrefetch(() => hydrate());
  } else if (import.meta.client) {
    void hydrate();
  }

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
    if (fetchError.value) {
      return 'Deployment feature flags could not be loaded for this request.';
    }
    const state = featureState(id);
    if (state.compiled) return null;
    if (!state.requested) {
      return 'This feature is turned off in Flagship for this deployment.';
    }
    if (!state.pluginPresent) {
      return 'Plugin files for this feature are missing from this build.';
    }
    return 'This feature is not available in this deployment.';
  }

  return {
    features: computed(() => {
      const out = {} as Record<DeploymentFeatureId, DeploymentFeatureState>;
      for (const id of DEPLOYMENT_FEATURE_IDS) {
        out[id] = featureState(id);
      }
      return out;
    }),
    loaded: computed(() => loaded.value),
    fetchError: computed(() => fetchError.value),
    hydrate,
    featureState,
    isCompiled,
    isRequested,
    unavailableReason,
  };
}
