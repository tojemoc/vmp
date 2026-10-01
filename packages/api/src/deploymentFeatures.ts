/**
 * Deployment feature catalog re-exports for API handlers.
 * Runtime evaluation lives in `infraFlags.ts` (Flagship).
 */
import {
  type DeploymentFeatureId,
  type DeploymentFeatureState,
  DEPLOYMENT_FEATURE_CATALOG,
  DEPLOYMENT_FEATURE_IDS,
} from '@vmp/shared';

export type { DeploymentFeatureId, DeploymentFeatureState };
export { DEPLOYMENT_FEATURE_IDS };

export function deploymentFeatureCatalogForAdmin() {
  return DEPLOYMENT_FEATURE_CATALOG;
}
