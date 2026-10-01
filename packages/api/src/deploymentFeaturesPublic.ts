import { deploymentFeatureCatalogForAdmin } from './deploymentFeatures.js';
import { buildInfraFeatureManifest, type InfraFlagsEnv } from './infraFlags.js';

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * GET /api/deployment-features — public Flagship infra manifest for web hydration.
 * No auth; values are non-secret on/off infrastructure toggles.
 */
export async function handlePublicDeploymentFeatures(
  request: Request,
  env: InfraFlagsEnv,
  corsHeaders: Record<string, string>,
) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  return jsonResponse(
    {
      features: await buildInfraFeatureManifest(env),
      catalog: deploymentFeatureCatalogForAdmin(),
    },
    200,
    corsHeaders,
  );
}
