import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type DeploymentFeatureId,
  DEPLOYMENT_FEATURE_IDS,
  type DeploymentFeatureState,
} from '@vmp/shared';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Modular features ship optional plugin files under `packages/web/features/<id>/`.
 * When files are absent (slim fork / dedicated Worker), the admin toggle is grayed out.
 *
 * A1: modules are always registered when present; Flagship gates runtime behaviour
 * via `useDeploymentFeatures` / `GET /api/deployment-features`.
 */
export const MODULAR_WEB_FEATURE_PLUGINS: Partial<Record<DeploymentFeatureId, string>> = {
  gtm: 'features/gtm/plugin.client.ts',
  pwa: 'features/pwa/pwa-auth.client.ts',
  posthog: 'features/posthog/posthog.client.ts',
};

export type WebDeploymentFeatures = Record<DeploymentFeatureId, DeploymentFeatureState>;

/** Build-time plugin presence map (not a Flagship allowlist). */
export function resolveWebDeploymentFeatures(): WebDeploymentFeatures {
  const states = {} as WebDeploymentFeatures;

  for (const id of DEPLOYMENT_FEATURE_IDS) {
    const pluginRel = MODULAR_WEB_FEATURE_PLUGINS[id];
    const pluginPresent = pluginRel
      ? fs.existsSync(path.join(webRoot, pluginRel))
      : true;

    // A1: always requested at build time when plugin files exist; Flagship is runtime.
    states[id] = {
      requested: true,
      pluginPresent,
      compiled: pluginPresent,
    };
  }

  return states;
}

export function isWebDeploymentFeatureCompiled(
  features: WebDeploymentFeatures,
  id: DeploymentFeatureId,
): boolean {
  return features[id]?.compiled === true;
}
