import { requireRole } from './auth.js';
import {
  buildDeploymentFeatureManifest,
  deploymentFeatureCatalogForAdmin,
} from './deploymentFeatures.js';

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** GET /api/admin/deployment-features — compile-time module manifest for admin UI. */
export async function handleAdminDeploymentFeatures(
  request: Request,
  env: { VMP_FEATURES?: string },
  corsHeaders: Record<string, string>,
) {
  try {
    await requireRole(request, env, 'admin', 'super_admin');
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  return jsonResponse(
    {
      features: buildDeploymentFeatureManifest(env),
      catalog: deploymentFeatureCatalogForAdmin(),
    },
    200,
    corsHeaders,
  );
}
