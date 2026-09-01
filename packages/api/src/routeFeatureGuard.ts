import type { DeploymentFeatureId } from './deploymentFeatures.js';
import { isDeploymentFeatureCompiled } from './deploymentFeatures.js';

type RouteFeatureRule = {
  prefix: string;
  feature: DeploymentFeatureId;
};

/**
 * Longest-prefix wins. Auth core routes are intentionally excluded.
 * `/api/admin/deployment-features` is always available to admins.
 */
const ROUTE_FEATURE_RULES: RouteFeatureRule[] = [
  { prefix: '/api/admin/pills', feature: 'pills' },
  { prefix: '/api/pills', feature: 'pills' },
  { prefix: '/api/admin/push-analytics', feature: 'push' },
  { prefix: '/api/admin/push', feature: 'push' },
  { prefix: '/api/push', feature: 'push' },
  { prefix: '/api/admin/newsletter', feature: 'newsletter' },
  { prefix: '/api/admin/einvoicing', feature: 'einvoicing' },
  { prefix: '/api/account/invoices', feature: 'einvoicing' },
  { prefix: '/api/admin/analytics', feature: 'analytics' },
  { prefix: '/api/admin/cms', feature: 'cms' },
  { prefix: '/api/cms', feature: 'cms' },
  { prefix: '/api/pages', feature: 'cms' },
  { prefix: '/api/site-footer', feature: 'cms' },
  { prefix: '/api/admin/site-footer', feature: 'cms' },
  { prefix: '/api/admin/legacy-migration', feature: 'legacy_migration' },
  { prefix: '/api/admin/rss/podcast-preview-rebuild', feature: 'rss_podcast_preview_mp3' },
  { prefix: '/api/admin/rss', feature: 'rss_podcast' },
  { prefix: '/api/feed', feature: 'rss_podcast' },
  { prefix: '/api/account/rss', feature: 'rss_podcast' },
  { prefix: '/api/admin/payments', feature: 'payments' },
  { prefix: '/api/payments', feature: 'payments' },
  { prefix: '/api/account/pricing', feature: 'payments' },
  { prefix: '/api/account/promotions', feature: 'payments' },
  { prefix: '/api/account/isic', feature: 'payments' },
  { prefix: '/api/admin/replication', feature: 'deno_replication' },
  { prefix: '/api/offline', feature: 'pwa' },
  { prefix: '/api/downloads', feature: 'pwa' },
  { prefix: '/api/auth/pwa-push-login', feature: 'pwa' },
  { prefix: '/api/auth/magic-pwa-handoff', feature: 'pwa' },
  { prefix: '/api/auth/redeem-pwa-handoff', feature: 'pwa' },
  { prefix: '/api/auth/device-pairing', feature: 'pwa' },
];
ROUTE_FEATURE_RULES.sort((a, b) => b.prefix.length - a.prefix.length);

function resolveRouteFeature(pathname: string): DeploymentFeatureId | null {
  for (const rule of ROUTE_FEATURE_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule.feature;
    }
  }
  return null;
}

export function maybeBlockDeploymentFeatureRoute(
  request: Request,
  env: { VMP_FEATURES?: string },
  corsHeaders: Record<string, string>,
): Response | null {
  if (request.method === 'OPTIONS') return null;

  const pathname = new URL(request.url).pathname;
  if (pathname === '/api/admin/deployment-features') return null;

  const featureId = resolveRouteFeature(pathname);
  if (!featureId) return null;
  if (isDeploymentFeatureCompiled(env, featureId)) return null;

  return new Response(
    JSON.stringify({
      error: 'Feature not available in this deployment',
      code: 'FEATURE_NOT_COMPILED',
      feature: featureId,
    }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    },
  );
}
