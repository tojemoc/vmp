import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type DeploymentFeatureId,
  DEPLOYMENT_FEATURE_IDS,
  type DeploymentFeatureState,
  parseDeploymentFeaturesEnv,
} from '@vmp/shared';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Modular features ship optional plugin files under `packages/web/features/<id>/`.
 * When files are absent (slim fork / dedicated Worker), the admin toggle is grayed out.
 */
export const MODULAR_WEB_FEATURE_PLUGINS: Partial<Record<DeploymentFeatureId, string>> = {
  gtm: 'features/gtm/plugin.client.ts',
};

export type WebDeploymentFeatures = Record<DeploymentFeatureId, DeploymentFeatureState>;

export function resolveWebDeploymentFeatures(
  env: Record<string, string | undefined> = process.env,
): WebDeploymentFeatures {
  const requested = parseDeploymentFeaturesEnv(env);
  const states = {} as WebDeploymentFeatures;

  for (const id of DEPLOYMENT_FEATURE_IDS) {
    const pluginRel = MODULAR_WEB_FEATURE_PLUGINS[id];
    const pluginPresent = pluginRel
      ? fs.existsSync(path.join(webRoot, pluginRel))
      : true;

    const requestedInDeploy = requested.has(id);
    states[id] = {
      requested: requestedInDeploy,
      pluginPresent,
      compiled: requestedInDeploy && pluginPresent,
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
