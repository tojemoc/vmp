/**
 * Deployment / infrastructure feature catalog.
 *
 * Control planes (see docs/plans/flagship-and-payment-middleware.md):
 * 1. Tier 1 infra — Cloudflare Flagship booleans (API `FLAGS` binding; code default off).
 * 2. Tenant runtime — `admin_settings` / `/api/admin/system/features`.
 * 3. Tier 2 rollout — PostHog SSR/client flags within an enabled module.
 *
 * Web modules are always registered (A1); Flagship gates behaviour at runtime via
 * `GET /api/deployment-features` hydration.
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

/** Parent → optional child features (child only meaningful when parent is enabled). */
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

/** Full catalog — used by local `FLAGSHIP_DEV_OVERRIDE` when unset means “all on”. */
export const DEFAULT_DEPLOYMENT_FEATURES: DeploymentFeatureId[] = [...DEPLOYMENT_FEATURE_IDS];

export type DeploymentFeatureState = {
  /** Enabled in Flagship (or local override allowlist). */
  requested: boolean;
  /** Optional module files exist on disk (modular features only; otherwise always true). */
  pluginPresent: boolean;
  /** `requested && pluginPresent` — this deployment may use the feature. */
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
 * Parse a comma/space-separated feature allowlist CSV.
 * Empty / unset → empty set (fail closed). Used by `FLAGSHIP_DEV_OVERRIDE`.
 */
export function parseFeatureAllowlistCsv(raw: string | undefined | null): Set<DeploymentFeatureId> {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return new Set();

  const tokens = trimmed
    .split(/[,\s]+/)
    .map(normalizeFeatureToken)
    .filter(Boolean);

  const selected = new Set<DeploymentFeatureId>();
  for (const token of tokens) {
    if (isDeploymentFeatureId(token)) {
      selected.add(token);
    }
  }
  return selected;
}

/**
 * @deprecated Prefer `parseFeatureAllowlistCsv`. Kept for transitional call sites.
 * When `env.FLAGSHIP_DEV_OVERRIDE` or `env.allowlist` is set, parses that CSV.
 * Legacy key `VMP_FEATURES` is ignored (fail closed → empty).
 */
export function parseDeploymentFeaturesEnv(
  env: Record<string, string | undefined> = {},
): Set<DeploymentFeatureId> {
  const raw = env.FLAGSHIP_DEV_OVERRIDE ?? env.allowlist;
  if (raw?.trim()) return parseFeatureAllowlistCsv(raw);
  // Empty allowlist — callers that previously treated unset as “all features”
  // must pass DEFAULT_DEPLOYMENT_FEATURES explicitly if they need that behaviour.
  return new Set();
}

export function deploymentFeatureCatalogEntry(
  id: DeploymentFeatureId,
): DeploymentFeatureCatalogEntry | undefined {
  return DEPLOYMENT_FEATURE_CATALOG.find((entry) => entry.id === id);
}
