/**
 * Map request pathnames to low-cardinality HTTP route templates for PostHog metrics.
 * Unknown paths collapse to {@link UNMATCHED_METRIC_HTTP_ROUTE} so client-supplied
 * segments cannot create unbounded series.
 */

/** Fixed label for paths that do not match any registered API route template. */
export const UNMATCHED_METRIC_HTTP_ROUTE = 'unmatched';

/** Exact pathname matches (no dynamic segments). */
const METRIC_HTTP_STATIC_ROUTES = new Set<string>([
  '/api/account/delete-confirm',
  '/api/account/delete-request',
  '/api/account/invoices',
  '/api/account/irl-events',
  '/api/account/isic/campaigns',
  '/api/account/isic/validate',
  '/api/account/newsletter-preference',
  '/api/account/playback-positions',
  '/api/account/playback-sessions',
  '/api/account/pricing',
  '/api/account/promotions/validate',
  '/api/account/rss',
  '/api/account/rss/rotate',
  '/api/account/subscription',
  '/api/account/transfer-subscription',
  '/api/admin/analytics',
  '/api/admin/bootstrap',
  '/api/admin/categories',
  '/api/admin/cms/media',
  '/api/admin/config',
  '/api/admin/deployment-features',
  '/api/admin/einvoicing/invoices',
  '/api/admin/einvoicing/settings',
  '/api/admin/homepage/content',
  '/api/admin/irl-events',
  '/api/admin/irl-events/check-in',
  '/api/admin/isic/campaigns',
  '/api/admin/legacy-migration/relink-candidates',
  '/api/admin/legacy-migration/send-relink-email',
  '/api/admin/legacy-migration/stats',
  '/api/admin/legacy-migration/validate-batch',
  '/api/admin/newsletter/campaigns',
  '/api/admin/newsletter/drafts',
  '/api/admin/newsletter/schedule',
  '/api/admin/newsletter/send',
  '/api/admin/newsletter/settings',
  '/api/admin/newsletter/sync',
  '/api/admin/newsletter/templates',
  '/api/admin/payments/legacy',
  '/api/admin/payments/plans',
  '/api/admin/payments/settings',
  '/api/admin/pills',
  '/api/admin/pills/image-upload',
  '/api/admin/pills/settings',
  '/api/admin/preview-locks',
  '/api/admin/promotions/campaigns',
  '/api/admin/promotions/codes',
  '/api/admin/push-analytics',
  '/api/admin/push/test',
  '/api/admin/replication',
  '/api/admin/replication/push',
  '/api/admin/rss/podcast-preview-rebuild',
  '/api/admin/rss/podcast-rebuild-webhook',
  '/api/admin/site-footer',
  '/api/admin/site-settings',
  '/api/admin/smoke-auth',
  '/api/admin/system/features',
  '/api/admin/users',
  '/api/admin/users/import-csv',
  '/api/admin/users/transfer-subscription',
  '/api/admin/videos',
  '/api/admin/videos/livestreams',
  '/api/analytics/pageview',
  '/api/auth/2fa/confirm',
  '/api/auth/2fa/disable',
  '/api/auth/2fa/setup',
  '/api/auth/2fa/verify',
  '/api/auth/device-pairing/complete',
  '/api/auth/device-pairing/poll',
  '/api/auth/device-pairing/preview',
  '/api/auth/device-pairing/start',
  '/api/auth/logout',
  '/api/auth/magic-link',
  '/api/auth/magic-pwa-handoff',
  '/api/auth/me',
  '/api/auth/native/insecure-scheme/acknowledge',
  '/api/auth/native/insecure-scheme/status',
  '/api/auth/native/redeem',
  '/api/auth/pwa-push-login/deliver',
  '/api/auth/pwa-push-login/init',
  '/api/auth/pwa-push-login/subscribe',
  '/api/auth/pwa-push-login/verify-2fa',
  '/api/auth/redeem-pwa-handoff',
  '/api/auth/refresh',
  '/api/auth/verify',
  '/api/auth/verify-code',
  '/api/cms/media/batch',
  '/api/downloads',
  '/api/downloads/licenses/renew',
  '/api/feed/public',
  '/api/health',
  '/api/homepage/content',
  '/api/homepage/placement',
  '/api/offline/devices',
  '/api/offline/devices/register',
  '/api/pages',
  '/api/payments/cancel',
  '/api/payments/checkout',
  '/api/payments/legacy/checkout',
  '/api/payments/legacy/complete',
  '/api/payments/legacy/order-status',
  '/api/payments/portal',
  '/api/payments/session-status',
  '/api/payments/stripe-config',
  '/api/payments/webhook',
  '/api/payments/webhook/comgate',
  '/api/payments/webhook/gopay',
  '/api/payments/webhook/legacy',
  '/api/payments/webhook/stripe',
  '/api/pills',
  '/api/pills/update',
  '/api/push/device',
  '/api/push/events',
  '/api/push/subscribe',
  '/api/push/vapid-public-key',
  '/api/recommendations',
  '/api/site-footer',
  '/api/site-settings',
  '/api/videos',
]);

/**
 * Dynamic route templates — most-specific patterns first.
 * `:id` / `:path` placeholders replace path parameters.
 */
const METRIC_HTTP_ROUTE_TEMPLATES: ReadonlyArray<{ re: RegExp; template: string }> = [
  { re: /^\/api\/downloads\/[^/]+\/assets\/.+$/, template: '/api/downloads/:id/assets/:path' },
  { re: /^\/api\/downloads\/[^/]+\/authorize$/, template: '/api/downloads/:id/authorize' },
  { re: /^\/api\/downloads\/[^/]+$/, template: '/api/downloads/:id' },
  { re: /^\/api\/offline\/devices\/[^/]+$/, template: '/api/offline/devices/:id' },
  {
    re: /^\/api\/account\/irl-events\/[^/]+\/rsvp$/,
    template: '/api/account/irl-events/:id/rsvp',
  },
  {
    re: /^\/api\/account\/playback-positions\/[^/]+$/,
    template: '/api/account/playback-positions/:id',
  },
  {
    re: /^\/api\/account\/playback-sessions\/[^/]+$/,
    template: '/api/account/playback-sessions/:id',
  },
  {
    re: /^\/api\/admin\/videos\/[^/]+\/pipeline-status$/,
    template: '/api/admin/videos/:id/pipeline-status',
  },
  {
    re: /^\/api\/admin\/videos\/[^/]+\/playback-positions$/,
    template: '/api/admin/videos/:id/playback-positions',
  },
  { re: /^\/api\/admin\/videos\/[^/]+\/thumbnail$/, template: '/api/admin/videos/:id/thumbnail' },
  { re: /^\/api\/admin\/videos\/[^/]+\/livestream$/, template: '/api/admin/videos/:id/livestream' },
  { re: /^\/api\/admin\/videos\/[^/]+\/notify$/, template: '/api/admin/videos/:id/notify' },
  { re: /^\/api\/admin\/videos\/[^/]+\/swap$/, template: '/api/admin/videos/:id/swap' },
  { re: /^\/api\/admin\/videos\/[^/]+$/, template: '/api/admin/videos/:id' },
  {
    re: /^\/api\/admin\/einvoicing\/invoices\/[^/]+$/,
    template: '/api/admin/einvoicing/invoices/:id',
  },
  { re: /^\/api\/admin\/irl-events\/[^/]+$/, template: '/api/admin/irl-events/:id' },
  {
    re: /^\/api\/admin\/newsletter\/templates\/[^/]+$/,
    template: '/api/admin/newsletter/templates/:id',
  },
  {
    re: /^\/api\/admin\/newsletter\/drafts\/[^/]+$/,
    template: '/api/admin/newsletter/drafts/:id',
  },
  {
    re: /^\/api\/pages\/[^/]+\/revisions\/[^/]+\/restore$/,
    template: '/api/pages/:id/revisions/:revisionId/restore',
  },
  { re: /^\/api\/pages\/[^/]+\/revisions$/, template: '/api/pages/:id/revisions' },
  { re: /^\/api\/pages\/[^/]+\/publish$/, template: '/api/pages/:id/publish' },
  { re: /^\/api\/pages\/[^/]+\/unpublish$/, template: '/api/pages/:id/unpublish' },
  { re: /^\/api\/pages\/[^/]+$/, template: '/api/pages/:id' },
  { re: /^\/api\/cms\/media\/[^/]+$/, template: '/api/cms/media/:id' },
  { re: /^\/api\/categories\/[^/]+\/videos$/, template: '/api/categories/:id/videos' },
  { re: /^\/api\/videos\/[^/]+\/meta$/, template: '/api/videos/:id/meta' },
  { re: /^\/api\/feed\/[^/]+\/[^/]+$/, template: '/api/feed/:userId/:token' },
  { re: /^\/api\/video-access\//, template: '/api/video-access/:userId/:videoId' },
  { re: /^\/api\/video-proxy\//, template: '/api/video-proxy/:path' },
  { re: /^\/api\/assets\//, template: '/api/assets/:path' },
];

/**
 * Resolve a request pathname to a registered metric route template.
 * Returns {@link UNMATCHED_METRIC_HTTP_ROUTE} when no template matches.
 */
export function resolveMetricHttpRoute(pathname: string): string {
  const path = String(pathname || '/').split('?')[0] || '/';
  if (METRIC_HTTP_STATIC_ROUTES.has(path)) return path;
  for (const { re, template } of METRIC_HTTP_ROUTE_TEMPLATES) {
    if (re.test(path)) return template;
  }
  return UNMATCHED_METRIC_HTTP_ROUTE;
}
