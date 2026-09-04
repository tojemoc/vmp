/**
 * Deployment feature modules — compile-time allowlist for optional product surfaces.
 *
 * Three control planes (see docs/plans/deployment-feature-modules.md):
 * 1. Deploy compile-time (`VMP_FEATURES`) — what code is baked into this Worker build.
 * 2. Tenant runtime (`admin_settings` / `/api/admin/system/features`) — per-site on/off.
 * 3. Rollout (`PostHog` / Cloudflare flags) — gradual UX experiments within compiled features.
 */

export const DEPLOYMENT_FEATURE_IDS = [
  'gtm',
  'posthog',
  'analytics',
  'cms',
  'pwa',
  'push',
  'pills',
  'newsletter',
  'einvoicing',
  'legacy_migration',
  'rss_podcast',
  'rss_podcast_preview_mp3',
  'payments',
  'deno_replication',
] as const;

export type DeploymentFeatureId = (typeof DEPLOYMENT_FEATURE_IDS)[number];

/** Parent → optional child features (child only meaningful when parent is compiled + enabled). */
export const DEPLOYMENT_FEATURE_PARENTS: Partial<
  Record<DeploymentFeatureId, DeploymentFeatureId>
> = {
  rss_podcast_preview_mp3: 'rss_podcast',
};

export type DeploymentFeatureCatalogEntry = {
  id: DeploymentFeatureId;
  label: string;
  /** Short admin / docs blurb. */
  description: string;
  /** When set, UI should treat this as a sub-toggle of the parent feature. */
  parentId?: DeploymentFeatureId;
};

export const DEPLOYMENT_FEATURE_CATALOG: DeploymentFeatureCatalogEntry[] = [
  {
    id: 'gtm',
    label: 'Google Tag Manager',
    description: 'Optional marketing tag gateway (first-party Cloudflare path supported).',
  },
  {
    id: 'posthog',
    label: 'PostHog',
    description: 'Product analytics, error tracking, and Support identity in the web app.',
  },
  {
    id: 'analytics',
    label: 'Admin analytics',
    description: 'First-party segment analytics tab and editor dashboards.',
  },
  {
    id: 'cms',
    label: 'CMS pages',
    description: 'Custom pages, footer, and personal-data CMS content.',
  },
  { id: 'pwa', label: 'PWA', description: 'Installable app shell, offline surface, and service worker.' },
  {
    id: 'push',
    label: 'Push notifications',
    description: 'Web Push campaigns and per-video notify actions.',
  },
  { id: 'pills', label: 'Pills', description: 'Homepage poll pills and external update API.' },
  {
    id: 'newsletter',
    label: 'Newsletter',
    description: 'Brevo subscriber sync and admin campaign send.',
  },
  {
    id: 'einvoicing',
    label: 'E-invoicing',
    description: 'SK eFaktura / Peppol invoice ledger and transmission.',
  },
  {
    id: 'legacy_migration',
    label: 'Legacy migration',
    description: 'Eshop import, relink flows, and migration admin tab.',
  },
  {
    id: 'rss_podcast',
    label: 'RSS / podcast feeds',
    description: 'Personal and public podcast RSS endpoints.',
  },
  {
    id: 'rss_podcast_preview_mp3',
    label: 'Podcast preview MP3 prerender',
    description: 'Shortened preview audio generation for the public podcast feed.',
    parentId: 'rss_podcast',
  },
  {
    id: 'payments',
    label: 'Payment gateways',
    description: 'Stripe and optional regional providers (GoPay, Comgate, Qerko legacy).',
  },
  {
    id: 'deno_replication',
    label: 'Deno Postgres replication',
    description: 'api-node ingest failover controls in Admin → System.',
  },
];

/** Full VMP instance — default when `VMP_FEATURES` is unset. */
export const DEFAULT_DEPLOYMENT_FEATURES: DeploymentFeatureId[] = [...DEPLOYMENT_FEATURE_IDS];

export type DeploymentFeatureState = {
  /** Listed in `VMP_FEATURES` (or default allow-all). */
  requested: boolean;
  /** Optional module files exist on disk (modular features only; otherwise always true). */
  pluginPresent: boolean;
  /** `requested && pluginPresent` — this deployment may load the feature. */
  compiled: boolean;
};

const FEATURE_ID_SET = new Set<string>(DEPLOYMENT_FEATURE_IDS);

export function isDeploymentFeatureId(value: string): value is DeploymentFeatureId {
  return FEATURE_ID_SET.has(value);
}

function normalizeFeatureToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, '_');
}

/**
 * Parse `VMP_FEATURES` (comma/space-separated allowlist).
 * When unset or empty, returns the full default set.
 */
export function parseDeploymentFeaturesEnv(
  env: Record<string, string | undefined> = {},
): Set<DeploymentFeatureId> {
  const raw = env.VMP_FEATURES?.trim();
  if (!raw) {
    return new Set(DEFAULT_DEPLOYMENT_FEATURES);
  }

  const tokens = raw
    .split(/[,\s]+/)
    .map(normalizeFeatureToken)
    .filter(Boolean);

  const selected = new Set<DeploymentFeatureId>();
  for (const token of tokens) {
    if (isDeploymentFeatureId(token)) {
      selected.add(token);
    }
  }

  // Always keep child features out unless explicitly listed; parent inclusion does not imply child.
  return selected;
}

export function deploymentFeatureCatalogEntry(
  id: DeploymentFeatureId,
): DeploymentFeatureCatalogEntry | undefined {
  return DEPLOYMENT_FEATURE_CATALOG.find((entry) => entry.id === id);
}
